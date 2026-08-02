import Matcher from '../matcher.js';
import type { ResultEntry, StartResult } from '../../shared/contracts.js';
import type { EvaluationInput } from '../db/repository.js';
import { type ProcessedCandidate } from './processedCandidate.js';
import { CandidateProcessor } from './candidateProcessor.js';
import type { JobRunnerDeps } from './ports.js';
import { RunState } from './runState.js';
import type { StartParams } from './types.js';
import { saveCookies, loadCookies } from '../cookieJar.js';
import { candidateIdentity } from './candidateIdentity.js';

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('运行已停止', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('运行已停止', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class JobRunner {
  private readonly state = new RunState();
  private readonly processor: CandidateProcessor;
  private runId: number | null = null;
  private jobTitle = '';
  private runController: AbortController | null = null;

  constructor(private readonly deps: JobRunnerDeps) {
    this.processor = new CandidateProcessor(deps.logger, deps.scanner, deps.scorer);
  }

  async start(params: StartParams): Promise<StartResult> {
    const { logger, browser, scanner } = this.deps;
    if (this.state.isRunning) {
      return { success: false, message: '正在处理中，请等待' };
    }

    this.state.begin(`正在打开 BOSS直聘并设置岗位：${params.bossJobTitle}`);
    const runController = new AbortController();
    this.runController = runController;
    const { signal } = runController;
    void (async () => {
      try {
        throwIfAborted(signal);
        await browser.connect();

        // Restore saved cookies before navigating
        const saved = await loadCookies();
        if (saved?.cookies) {
          logger.info(`加载已保存的 Cookie (${new Date(saved.savedAt).toLocaleString('zh-CN')})`);
          await browser.injectCookies(saved.cookies);
          await sleep(500, signal);
        }

        await browser.navigate('https://www.zhipin.com/web/chat/recommend');
        logger.info('已导航到 BOSS直聘推荐页');
        await sleep(4000, signal);

        if (!this.state.isRunning) return;

        // Check login state — _inFrame from scanner reaches the BOSS iframe
        const checkRaw = await browser.eval(
          `() => {
            var f = document.querySelector('iframe');
            if (!f) return JSON.stringify({error:'no iframe'});
            var doc = f.contentDocument || f.contentWindow.document;
            if (!doc) return JSON.stringify({error:'cross origin'});
            var hasLogin = !!(doc.querySelector('.user-nav, .header-login .is-login, .user-info-panel'));
            var hasCards = doc.querySelectorAll('ul.card-list > li.card-item').length > 0;
            return JSON.stringify({inFrame: true, loggedIn: hasLogin, hasCards: hasCards, title: doc.title});
          }`
        );
        try {
          const check = JSON.parse(String(checkRaw ?? '{}'));
          if (check.loggedIn && !check.error) {
            logger.info('检测到 BOSS 已登录，保存 Cookie…');
            const freshCookies = await browser.getCookies();
            if (freshCookies) await saveCookies(logger, freshCookies);
          } else if (check.hasCards && !check.error) {
            // Card list visible = already logged in even if no explicit login widget
            logger.info('检测到推荐列表（已登录态），保存 Cookie…');
            const freshCookies = await browser.getCookies();
            if (freshCookies) await saveCookies(logger, freshCookies);
          } else if (check.error) {
            logger.warn(`登录检测无法进入 iframe: ${check.error}，可能为跨域，跳过 Cookie 保存`);
          } else {
            logger.warn('⚠️ 未检测到 BOSS 登录状态。请手动在浏览器中登录 BOSS直聘，下次运行时 Cookie 将自动保存。');
          }
        } catch {
          logger.warn('登录状态检测解析失败，Cookie 未保存');
        }

        if (!this.state.isRunning) return;

        const configured = await scanner.configurePage(params.bossJobTitle, params.bossFilters);
        if (!configured.success) {
          throw new Error(configured.reason || '岗位或筛选条件应用失败');
        }
        if (!this.state.isRunning) return;

        logger.info(`已自动设置岗位: ${configured.job ?? params.bossJobTitle}`);
        this.state.update('running', `已设置岗位，开始处理：${params.bossJobTitle}`);
        await this.runFlow(signal);
      } catch (error) {
        if (signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`启动失败: ${message}`);
        this.state.fail(`启动失败: ${message}`);
      } finally {
        if (this.runController === runController) this.runController = null;
      }
    })();

    return { success: true, message: '正在打开 BOSS直聘并应用筛选条件', phase: 'navigating' };
  }

  stop(): void {
    if (this.state.isRunning) {
      this.state.stop();
      this.runController?.abort();
    }
  }

  getStatus() {
    return this.state.status();
  }

  getResults(): ResultEntry[] {
    return this.state.allResults;
  }

  markGreeted(candidate: { name: string; index: number }): void {
    this.state.markGreeted(candidate);
  }

  private async persist(
    card: ProcessedCandidate['card'],
    evaluation: Omit<EvaluationInput, 'candidateId' | 'runId' | 'jobTitle'>,
    resumeText?: string,
  ): Promise<void> {
    try {
      const candidateId = await this.deps.candidates.upsertCandidate(
        card,
        resumeText,
        { card, resumeText: resumeText ?? null },
      );
      await this.deps.candidates.addEvaluation({
        ...evaluation,
        candidateId,
        runId: this.runId,
        jobTitle: this.jobTitle,
        resumeSnapshot: resumeText ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn(`候选人持久化失败，主流程继续: ${message}`);
    }
  }

  private async finishRun(status: 'done' | 'stopped' | 'error', greetedCount: number): Promise<void> {
    try {
      await this.deps.candidates.finishRun(this.runId, status, greetedCount);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn(`运行记录更新失败: ${message}`);
    }
  }

  private async runFlow(signal: AbortSignal): Promise<void> {
    const { logger, jobs, scanner, greeter, settings, candidates } = this.deps;
    let greetedCount = 0;
    let processedCount = 0;
    try {
      throwIfAborted(signal);
      logger.step('启动 BOSS直聘智能筛选打招呼');
      await jobs.loadAll();
      const runtime = settings.get();
      const pageJobTitle = runtime.bossJobTitle || runtime.selectedJob || await scanner.detectPageJobTitle();
      const jd = jobs.jds.find((item) => item.title === runtime.selectedJob) || jobs.matchJob(pageJobTitle);
      if (!jd) throw new Error('无法匹配到岗位 JD，请确认已选择岗位');

      const threshold = Math.max(jobs.getThreshold(jd.title), runtime.minScore);
      const matcher = new Matcher(jd, logger, runtime.candidateAgeMin ?? 23, runtime.candidateAgeMax ?? 30);
      this.jobTitle = jd.title;
      try {
        this.runId = await candidates.startRun(jd.title, runtime.bossJobTitle || runtime.selectedJob);
      } catch (error) {
        logger.warn(`运行记录创建失败，主流程继续: ${error instanceof Error ? error.message : String(error)}`);
        this.runId = null;
      }

      const config = settings.get();
      const seen = new Set<string>();
      let pendingCards: ProcessedCandidate['card'][] = [];

      // 选完岗位页面会刷新,等卡片真正渲染出来再进入主流程,避免首轮扫到空 doc
      for (let wait = 0; wait < 5; wait++) {
        throwIfAborted(signal);
        pendingCards = await scanner.scanCards();
        if (pendingCards.length > 0) break;
        logger.info('等待牛人列表渲染…');
        await sleep(1500, signal);
      }

      while (
        this.state.isRunning &&
        greetedCount < config.totalGreetTarget &&
        processedCount < config.maxCandidates
      ) {
        const fresh = (list: ProcessedCandidate['card'][]): ProcessedCandidate['card'][] => list.filter((card) => {
          const key = candidateIdentity(card);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        let cards = fresh(pendingCards.length > 0 ? pendingCards : await scanner.scanCards());
        pendingCards = [];

        if (cards.length === 0) {
          logger.info(`本轮无新卡片(seen=${seen.size})，尝试滚动加载`);
          let emptyScrolls = 0;
          for (; emptyScrolls < config.maxEmptyScrolls; emptyScrolls++) {
            throwIfAborted(signal);
            await sleep((settings.get().scanIntervalSec ?? 3) * 1000, signal);
            await scanner.scrollToLoadMore();
            const more = fresh(await scanner.scanCards());
            logger.info(`滚动后新增卡片: ${more.length} (seen=${seen.size})`);
            if (more.length > 0) {
              cards = more; // 关键:滚动扫到的新人直接交给下方处理循环,不能丢弃
              break;
            }
          }
          if (cards.length === 0) {
            logger.warn(`连续 ${emptyScrolls} 次滚动无新卡片，停止`);
            break;
          }
        }

        logger.info(`本轮待处理新卡片: ${cards.length}`);
        for (const card of cards) {
          throwIfAborted(signal);
          if (greetedCount >= config.totalGreetTarget || processedCount >= config.maxCandidates) break;
          processedCount += 1;

          logger.step('评估 (' + processedCount + '/' + config.maxCandidates + '): ' + card.name);
          const runtime = settings.get();
          const outcome = await this.processor.process(
            card, matcher, jd, threshold,
            { evaluate: (runtime.evaluateIntervalSec ?? 3) * 1000, closeDetail: (runtime.closeDetailIntervalSec ?? 1.5) * 1000 },
            signal,
          );
          throwIfAborted(signal);
          if (outcome.kind !== 'accepted') {
            this.state.add(outcome.entry);
            await this.persist(card, outcome.evaluation, outcome.resumeText);
            continue;
          }

          // 通过 AI 打分 -> 立即打招呼
          const { candidate } = outcome;
          logger.step('打招呼 [' + (greetedCount + 1) + '/' + config.totalGreetTarget + ']: ' + candidate.card.name + ' (' + candidate.score + ' 分)');
          let greet;
          try {
            greet = await greeter.greet(candidate.card, signal);
          } finally {
            if (!await scanner.closeDetail()) logger.warn(`停止后未能关闭 ${candidate.card.name} 的详情面板`);
          }
          const success = greet.success;
          const detail = success ? candidate.aiResult.reason : (greet.reason || '打招呼失败');
          this.state.add(this.result(
            candidate,
            success ? 'greeted' : 'error',
            success ? 'greet' : 'greet_failed',
            detail,
          ));
          await this.persist(candidate.card, {
            status: success ? 'greeted' : 'error',
            stage: success ? 'greet' : 'greet_failed',
            aiScore: candidate.score,
            aiReason: success ? candidate.aiResult.reason : null,
            matchedSkills: candidate.aiResult.matchedSkills,
            detail: success ? null : detail,
          }, candidate.resumeText);
          if (success) greetedCount += 1;
          await sleep((runtime.greetIntervalSec ?? 2) * 1000, signal);
        }
      }

      if (processedCount >= config.maxCandidates && greetedCount < config.totalGreetTarget) {
        logger.warn(`已达到最多评估 ${config.maxCandidates} 人的限制`);
      }
      logger.success('处理完成，共打招呼 ' + greetedCount + ' 人');
      this.state.complete('完成，打招呼 ' + greetedCount + ' 人');
      await this.finishRun('done', greetedCount);
    } catch (error) {
      if (signal.aborted || this.state.currentPhase === 'stopped') {
        await this.finishRun('stopped', greetedCount);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error('流程异常: ' + message);
      this.state.fail('异常: ' + message);
      await this.finishRun('error', greetedCount);
    }
  }

  private result(
    candidate: ProcessedCandidate,
    status: ResultEntry['status'],
    stage: ResultEntry['stage'],
    reason: string,
  ): ResultEntry {
    return {
      ...candidate.card,
      status,
      stage,
      score: candidate.score,
      reason,
      matchedSkills: candidate.aiResult.matchedSkills,
      timestamp: new Date().toISOString(),
    };
  }
}
