import type { CandidateCard } from '../shared/contracts.js';
import type { BrowserPort, GreeterPort, GreetResult, LoggerPort } from './core/ports.js';

const MAX_RETRIES = 3;
const DELAY_BETWEEN_MS = 2500;
// 等待 BOSS 弹窗/按钮渲染与状态变更的轮询参数。
// 简历面板是 WASM canvas 渲染，打开较慢——固定 sleep 在慢机器上会在按钮出现前就开始找。
const WAIT_TIMEOUT_MS = 6000;
const POLL_INTERVAL_MS = 400;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('运行已停止', 'AbortError');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const parsed: unknown = JSON.parse(value);
    return asRecord(parsed);
  }
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

// ── 注入 iframe 的页面探针 ─────────────────────────────────────────────
// 这些都是 IIFE 字符串，在 _inFrame 包装里以 `doc`（iframe document）为作用域执行。

// 按姓名定位卡片，index 兜底（页面重渲染后 index 可能漂移，姓名优先）。
function findTargetCardExpr(name: string, index: number, sourceId = ''): string {
  return `
    var cards = doc.querySelectorAll('ul.card-list > li.card-item');
    var targetName = ${JSON.stringify(name)};
    var sourceId = ${JSON.stringify(sourceId)};
    var target = sourceId ? Array.from(cards).find(function(el) {
      var href = el.querySelector('a[href]');
      return el.getAttribute('data-geek-id') === sourceId || el.getAttribute('data-id') === sourceId ||
        (href && href.getAttribute('href') === sourceId);
    }) : null;
    target = target || Array.from(cards).find(function(el) {
      var name = el.querySelector('.name');
      return name && name.innerText.trim() === targetName;
    }) || cards[${index}];
  `;
}

// 在可见的详情弹窗里找可点击的打招呼按钮；其次卡片上的按钮。
const FIND_GREET_BUTTON_EXPR = `
  var isVisible = function(el) {
    if (!el || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    var classes = String(el.className || '').toLowerCase();
    var toks = classes.split(/\\s+/);
    var badTokens = {hidden:1, hide:1, closed:1, closing:1, 'v-leave':1, 'v-leave-active':1, 'fade-leave':1, 'fade-leave-active':1};
    for (var ti = 0; ti < toks.length; ti++) { if (badTokens[toks[ti]]) return false; }
    var style = doc.defaultView.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      style.opacity !== '0' && style.pointerEvents !== 'none' &&
      (el.offsetWidth > 0 || el.offsetHeight > 0);
  };
  var findGreetButton = function() {
    var popups = doc.querySelectorAll('.boss-popup__wrapper, .boss-dialog, .resumeGreet, .operate-side, .chat-dialog, .dialog-container, [class*="popup"], [class*="dialog"]');
    for (var p = 0; p < popups.length; p++) {
      if (!isVisible(popups[p])) continue;
      var b = popups[p].querySelector('.btn-greet, button.greet, [class*="greet"]');
      if (b && isVisible(b) && !b.disabled) return b;
    }
    var allBtns = doc.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < allBtns.length; i++) {
      var t = (allBtns[i].innerText || '').trim();
      if ((t === '打招呼' || t === '立即沟通' || t === '沟通' || t.indexOf('打招呼') !== -1) && isVisible(allBtns[i]) && !allBtns[i].disabled) return allBtns[i];
    }
    return null;
  };
  // 诊断：所有可见按钮文本（失败时用）
  var dumpVisibleButtons = function() {
    var popups = doc.querySelectorAll('.boss-popup__wrapper, .boss-dialog, .resumeGreet, .operate-side, .chat-dialog, .dialog-container, [class*="popup"], [class*="dialog"]');
    var visibleBtns = [];
    for (var p = 0; p < popups.length; p++) {
      if (!isVisible(popups[p])) continue;
      var bs = popups[p].querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) {
        if (isVisible(bs[i])) visibleBtns.push((bs[i].innerText||'').trim() || '(no text) '+(bs[i].className||''));
      }
    }
    if (visibleBtns.length === 0) {
      var allBs = doc.querySelectorAll('button');
      for (var j = 0; j < allBs.length; j++) {
        if (isVisible(allBs[j])) visibleBtns.push((allBs[j].innerText||'').trim() || '(no text) '+(allBs[j].className||''));
      }
    }
    return visibleBtns.slice(0, 15);
  };
`;

// 检测 BOSS 风控验证弹窗（滑块/图形验证）。
const DETECT_VERIFY_EXPR = `
  var hasVerify = !!doc.querySelector(
    '.geetest_wrap, .geetest_panel, .nc-container, .slide-verify, [class*="captcha"], [class*="verify-slider"], [id*="captcha"]'
  );
`;

class Greeter implements GreeterPort {
  constructor(
    private readonly logger: LoggerPort,
    private readonly bw: BrowserPort,
  ) {}

  private async _inFrame(jsCode: string): Promise<unknown> {
    return this.bw.eval(`
      () => {
        var f = document.querySelector('iframe');
        if (!f) return JSON.stringify({error: 'no iframe'});
        var doc = f.contentDocument || f.contentWindow.document;
        if (!doc) return JSON.stringify({error: 'no iframe doc'});
        return (${jsCode});
      }
    `);
  }

  // 轮询注入表达式，直到其返回的 JSON 满足 done 或超时。
  private async _pollUntil(
    expr: string,
    done: (parsed: Record<string, unknown>) => boolean,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    let last: Record<string, unknown> = {};
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      try {
        last = asRecord(await this._inFrame(expr));
        if (done(last)) return last;
      } catch {
        // 注入瞬时失败（iframe 重建中等）——继续轮询直到超时
      }
      await this._sleep(POLL_INTERVAL_MS, signal);
    }
    return last;
  }

  async greet(candidate: Pick<CandidateCard, 'name' | 'index' | 'sourceId'>, signal?: AbortSignal): Promise<GreetResult> {
    throwIfAborted(signal);
    this.logger.action(`打招呼: ${candidate.name || '未知'}`);
    const name = candidate.name || '';
    const index = candidate.index;
    const sourceId = candidate.sourceId || '';

    // 1. 点击卡片打开详情弹窗
    try {
      const openResult = await this._inFrame(`
        (() => {
          ${findTargetCardExpr(name, index, sourceId)}
          if (target && target.querySelector('.card-inner')) {
            target.querySelector('.card-inner').click();
            return JSON.stringify({ok: true});
          }
          return JSON.stringify({ok: false, error: 'card not found'});
        })()
      `);
      const opened = asRecord(openResult);
      if (opened.ok !== true) {
        this.logger.warn(`未找到候选人卡片: ${candidate.name}`);
        return { success: false, reason: 'card_not_found' };
      }
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      this.logger.warn(`点击卡片失败: ${err.message}`);
      return { success: false, reason: 'click_card_failed' };
    }

    // 2. 等招呼按钮真正出现（弹窗是 WASM 渲染，固定 sleep 不可靠）。
    const readyExpr = `
      (() => {
        ${FIND_GREET_BUTTON_EXPR}
        ${DETECT_VERIFY_EXPR}
        var btn = findGreetButton();
        var btnDump = btn ? null : dumpVisibleButtons();
        return JSON.stringify({ready: !!btn, verify: hasVerify, dbgBtns: btnDump});
      })()
    `;
    const ready = await this._pollUntil(readyExpr, (p) => p.ready === true || p.verify === true, WAIT_TIMEOUT_MS, signal);
    if (ready.verify === true && ready.ready !== true) {
      this.logger.warn(`检测到风控验证弹窗: ${candidate.name}`);
      return { success: false, reason: 'captcha' };
    }
    if (ready.ready !== true) {
      const dbgBtns = Array.isArray(ready.dbgBtns) ? ready.dbgBtns.join(', ') : '无诊断数据';
      this.logger.warn(`详情面板/招呼按钮 ${WAIT_TIMEOUT_MS}ms 内未出现: ${candidate.name} [可见按钮: ${dbgBtns}]`);
      return { success: false, reason: 'greet_button_not_found' };
    }

    // 3. 点打招呼，最多重试 MAX_RETRIES 次
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      throwIfAborted(signal);
      if (attempt > 1) {
        this.logger.action(`第 ${attempt} 次重试...`);
        await this._sleep(DELAY_BETWEEN_MS, signal);
      }

      // 3a. 点击
      try {
        const clickResult = await this._inFrame(`
          (() => {
            ${FIND_GREET_BUTTON_EXPR}
            ${findTargetCardExpr(name, index, sourceId)}
            var btn = findGreetButton();
            if (!btn) {
              var cardBtn = target ? target.querySelector('.btn-greet') : null;
              if (cardBtn && !cardBtn.disabled) btn = cardBtn;
            }
            if (btn && !btn.disabled) {
              // BOSS anti-bot: synthetic .click() often ignored. Dispatch real MouseEvent.
              var evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView });
              btn.dispatchEvent(evt);
              return JSON.stringify({clicked: true, text: (btn.innerText || '').trim()});
            }
            var btnDump = dumpVisibleButtons();
            return JSON.stringify({clicked: false, error: 'no clickable greet button', dbgBtns: btnDump});
          })()
        `);

        const parsed = asRecord(clickResult);
        if (parsed.clicked !== true) {
          this.logger.warn(`尝试 ${attempt}/${MAX_RETRIES}: 未找到可点击的打招呼按钮`);
          continue;
        }
        this.logger.action(`已点击按钮，等待状态变更...`);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        this.logger.warn(`尝试 ${attempt}/${MAX_RETRIES}: 点击异常 ${err.message}`);
        continue;
      }

      // 3b. 轮询等 BOSS 处理结果（状态变更 / 风控弹窗），不再固定 sleep。
      const verifyExpr = `
        (() => {
          ${findTargetCardExpr(name, index, sourceId)}
          ${DETECT_VERIFY_EXPR}
          if (!target) return JSON.stringify({state: 'gone', verify: hasVerify});
          // 成功的信号：卡片上有 '继续沟通' 或 '已沟通' 文案。
          // .btn-greet 在卡片上——点完后 BOSS 将其文本改成「继续沟通」且 className 改为 btn-continue。
          var txt = target.innerText || '';
          var cardGreetBtn = target.querySelector('.btn-greet');
          var cardContinueBtn = target.querySelector('.btn-continue, [class*="continue"]');
          var cardBtn = cardGreetBtn || cardContinueBtn;
          var btnText = cardBtn ? (cardBtn.innerText || '').trim() : '';
          var textSaysGreeted = txt.indexOf('继续沟通') !== -1 || txt.indexOf('已沟通') !== -1;
          var btnSaysGreeted = btnText === '继续沟通' || btnText === '已沟通' || (cardContinueBtn && !cardContinueBtn.disabled);
          var success = textSaysGreeted || btnSaysGreeted;
          var stillGreet = !success && (btnText === '打招呼');
          return JSON.stringify({
            state: success ? 'greeted' : (stillGreet ? 'pending' : 'unknown'),
            btnText: btnText,
            hasBtn: !!cardBtn,
            verify: hasVerify
          });
        })()
      `;
      const v = await this._pollUntil(
        verifyExpr,
        (p) => p.state === 'greeted' || p.verify === true,
        WAIT_TIMEOUT_MS,
        signal,
      );

      if (v.verify === true) {
        this.logger.warn(`打招呼触发风控验证: ${candidate.name}`);
        return { success: false, reason: 'captcha' };
      }
      if (v.state === 'greeted') {
        const detail = typeof v.btnText === 'string' && v.btnText ? `按钮: ${v.btnText}` : '按钮已变更';
        this.logger.success(`已打招呼: ${candidate.name} (${detail})`);
        return { success: true, reason: 'greeted' };
      }
      if (v.state === 'gone') {
        // 卡片在 iframe 重渲染后丢失，无法判定——按失败处理并说明，而非假定成功。
        this.logger.warn(`尝试 ${attempt}/${MAX_RETRIES}: 卡片定位丢失，无法确认打招呼结果 [btn=${String(v.btnText || '无')} hasBtn=${v.hasBtn}]`);
        continue;
      }

      this.logger.warn(`尝试 ${attempt}/${MAX_RETRIES}: 状态未变更 (按钮: ${String(v.btnText || '无')}, state=${String(v.state || '?')}, hasBtn=${v.hasBtn})`);
    }

    this.logger.error(`打招呼失败 ${MAX_RETRIES} 次，跳过: ${candidate.name}`);
    return { success: false, reason: 'max_retries_exceeded' };
  }

  private _sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
}

export default Greeter;
