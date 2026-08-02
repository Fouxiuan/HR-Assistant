import config from './config.js';
import type { BossFilters, CandidateCard } from '../shared/contracts.js';
import type { BrowserPort, LoggerPort, ScannerPort } from './core/ports.js';

const FILTER_SETTLE_MS = 500;

interface BrowserResult {
  ok?: boolean;
  error?: string;
  title?: string;
  text?: string;
  cardLen?: number;
  dialogLen?: number;
  method?: string;
  closed?: boolean;
  clicked?: boolean;
  open?: boolean;
  [key: string]: unknown;
}

interface ConfigureResult {
  success: boolean;
  job?: string;
  reason?: string;
  filters?: Record<string, BrowserResult[]>;
}

function parseUnknownJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function parseBrowserResult(value: unknown): BrowserResult {
  const parsed = parseUnknownJson(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const record = parsed as Record<string, unknown>;
  return {
    ...record,
    ok: typeof record.ok === 'boolean' ? record.ok : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
    title: typeof record.title === 'string' ? record.title : undefined,
    text: typeof record.text === 'string' ? record.text : undefined,
    cardLen: typeof record.cardLen === 'number' ? record.cardLen : undefined,
    dialogLen: typeof record.dialogLen === 'number' ? record.dialogLen : undefined,
    method: typeof record.method === 'string' ? record.method : undefined,
    closed: typeof record.closed === 'boolean' ? record.closed : undefined,
    clicked: typeof record.clicked === 'boolean' ? record.clicked : undefined,
    open: typeof record.open === 'boolean' ? record.open : undefined,
  };
}

function parseCandidateCards(value: unknown): CandidateCard[] | BrowserResult {
  const parsed = parseUnknownJson(value);
  if (!Array.isArray(parsed)) return parseBrowserResult(parsed);
  return parsed.flatMap((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return [];
    const card = item as Record<string, unknown>;
    const stringField = (key: string): string => typeof card[key] === 'string' ? card[key] : '';
    return [{
      index: typeof card.index === 'number' ? card.index : index,
      sourceId: stringField('sourceId') || undefined,
      name: stringField('name'),
      salary: stringField('salary'),
      age: stringField('age'),
      years: stringField('years'),
      education: stringField('education'),
      status: stringField('status'),
      expected: stringField('expected'),
      advantage: stringField('advantage'),
      tags: Array.isArray(card.tags) ? card.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      fullText: stringField('fullText'),
    }];
  });
}

class Scanner implements ScannerPort {
  constructor(
    private readonly logger: LoggerPort,
    private readonly bw: BrowserPort,
    private readonly actionDelayMs: () => number = () => config.runtime.actionDelayMs,
  ) {}

  // Helper: run JS inside the BOSS直聘 iframe
  private async _inFrame(jsCode: string): Promise<unknown> {
    const raw = await this.bw.eval(`
      () => {
        var f = document.querySelector('iframe');
        if (!f) return JSON.stringify({error: 'no iframe'});
        var doc = f.contentDocument || f.contentWindow.document;
        if (!doc) return JSON.stringify({error: 'no iframe doc'});
        return (${jsCode});
      }
    `);
    if (typeof raw !== 'string') return raw;
    const text = raw.trim();
    try {
      return parseUnknownJson(text);
    } catch {}
    return { ok: false, error: text || 'BrowserWing returned an empty result' };
  }

  async detectPageJobTitle(): Promise<string> {
    this.logger.action('检测当前页面岗位名');
    try {
      const title = await this._inFrame(`
        (() => {
          const label = doc.querySelector('.job-selecter-wrap .ui-dropmenu-label');
          return JSON.stringify({title: label ? label.innerText.trim() : doc.title});
        })()
      `);
      const parsed = parseBrowserResult(title);
      const t = parsed.title || (typeof title === 'string' ? title : '');
      this.logger.info(`页面岗位名: ${t}`);
      return t;
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      this.logger.error(`检测岗位名失败: ${err.message}`);
      return '';
    }
  }

  async scanCards(): Promise<CandidateCard[]> {
    this.logger.step('扫描牛人卡片');
    try {
      const result = await this._inFrame(`
        (() => {
          const items = doc.querySelectorAll('ul.card-list > li.card-item');
          const cards = Array.from(items).map((el, i) => {
            const nameEl = el.querySelector('.name');
            const salaryEl = el.querySelector('.salary-wrap span');
            const baseInfoEls = el.querySelectorAll('.base-info span');
            const expectEl = el.querySelector('.expect-wrap .content');
            const descEl = el.querySelector('.geek-desc .content');
            const tagEls = el.querySelectorAll('.tag-item');
            return {
              index: i,
              sourceId: el.getAttribute('data-geek-id') || el.getAttribute('data-id') ||
                (el.querySelector('a[href]') ? el.querySelector('a[href]').getAttribute('href') : ''),
              name: nameEl ? nameEl.innerText.trim() : '未知',
              salary: salaryEl ? salaryEl.innerText.trim() : '',
              age: baseInfoEls[0] ? baseInfoEls[0].innerText.trim() : '',
              years: baseInfoEls[1] ? baseInfoEls[1].innerText.trim() : '',
              education: baseInfoEls[2] ? baseInfoEls[2].innerText.trim() : '',
              status: baseInfoEls[3] ? baseInfoEls[3].innerText.trim() : '',
              expected: expectEl ? expectEl.innerText.trim().replace(/\\s+/g, ' ') : '',
              advantage: descEl ? descEl.innerText.trim() : '',
              tags: Array.from(tagEls).map(t => t.innerText.trim()),
              fullText: el.innerText || '',
            };
          });
          return JSON.stringify(cards);
        })()
      `);

      const cards = parseCandidateCards(result);

      if (Array.isArray(cards) && cards.length > 0) {
        this.logger.info(`找到 ${cards.length} 个牛人卡片`);
        return cards;
      }

      // Handle error response
      if (!Array.isArray(cards) && cards.error) {
        this.logger.warn(`扫描失败: ${cards.error}`);
        return [];
      }

      this.logger.warn('未找到牛人卡片');
      return [];
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      this.logger.error(`扫描卡片失败: ${err.message}`);
      return [];
    }
  }

  async clickCard(card: CandidateCard): Promise<boolean> {
    this.logger.action(`点击卡片查看详情: ${card.name}`);
    try {
      const result = await this._inFrame(`
        (() => {
          var cards = doc.querySelectorAll('ul.card-list > li.card-item');
          var targetName = ${JSON.stringify(card.name || '')};
          var sourceId = ${JSON.stringify(card.sourceId || '')};
          var target = sourceId ? Array.from(cards).find(function(el) {
            var href = el.querySelector('a[href]');
            return el.getAttribute('data-geek-id') === sourceId || el.getAttribute('data-id') === sourceId ||
              (href && href.getAttribute('href') === sourceId);
          }) : null;
          target = target || Array.from(cards).find(function(el) {
            var name = el.querySelector('.name');
            return name && name.innerText.trim() === targetName;
          }) || cards[${card.index}];
          if (target) {
            var inner = target.querySelector('.card-inner');
            if (inner) { inner.click(); return JSON.stringify({ok: true}); }
          }
          return JSON.stringify({ok: false, error: 'card not found'});
        })()
      `);
      const parsed = parseBrowserResult(result);
      if (!parsed?.ok) {
        this.logger.warn(`未找到候选人卡片: ${card.name}`);
        return false;
      }
      await this._sleep(config.runtime.dialogDelayMs + Math.floor(Math.random() * 1000));
      return true;
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      this.logger.error(`点击卡片失败: ${err.message}`);
      return false;
    }
  }

  async extractResume(cardIndex: number): Promise<string> {
    this.logger.action('提取简历详情');
    try {
      const idx = cardIndex ?? 0;

      // BOSS 新版推荐弹窗 (2026): WASM canvas 渲染简历 body, 右侧 resume-simple-box
      // 保留经历概览文本, 放弃曾有的查看全部/标签分区提取 (canvas innerText 为空)
      const result = await this._inFrame(`
        (() => {
          var dialog = doc.querySelector('.boss-popup__wrapper, .boss-dialog');
          var summary = dialog ? dialog.querySelector('.resume-summary, .resume-simple-box') : null;
          var summaryText = summary ? summary.innerText.trim() : '';

          // ── card info (from list) ────────────────
          var item = doc.querySelectorAll('ul.card-list > li.card-item')[${idx}];
          var cardText = '';
          if (item) {
            var name = item.querySelector('.name');
            var salary = item.querySelector('.salary-wrap span');
            var info = item.querySelectorAll('.base-info span');
            var expectEl = item.querySelector('.expect-wrap .content');
            var desc = item.querySelector('.geek-desc .content');
            var tags = item.querySelectorAll('.tag-item');
            var parts = [];
            if (name) parts.push('姓名:' + name.innerText.trim());
            if (salary) parts.push('薪资:' + salary.innerText.trim());
            if (info.length) parts.push('信息:' + Array.from(info).map(function(s){return s.innerText.trim()}).join(' '));
            if (expectEl) parts.push('期望:' + expectEl.innerText.trim().replace(/\\s+/g, ' '));
            if (desc) parts.push('优势:' + desc.innerText.trim());
            if (tags.length) parts.push('标签:' + Array.from(tags).map(function(t){return t.innerText.trim()}).join(','));
            cardText = parts.join('\\n');
          }

          var combined = [cardText, summaryText].filter(Boolean).join('\\n\\n===== 经历概览 =====\\n\\n');
          return JSON.stringify({text: combined, len: combined.length, cardLen: cardText.length, summaryLen: summaryText.length});
        })()
      `);

      const parsed = parseBrowserResult(result);
      if (parsed?.error) {
        this.logger.warn(`提取失败: ${parsed.error}`);
        return '';
      }
      const text = parsed?.text || '';
      this.logger.info(`简历详情: ${text.length} 字符 (卡片 ${parsed?.cardLen || 0} + 经历 ${parsed?.summaryLen || 0})`);
      return text;
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      this.logger.error(`提取详情失败: ${err.message}`);
      return '';
    }
  }

  async configurePage(jobTitle: string, filters: BossFilters = {}): Promise<ConfigureResult> {
    this.logger.action(`自动设置招聘岗位: ${jobTitle}`);
    try {
      const opened = await this._inFrame(`
        (() => {
          var label = doc.querySelector('.job-selecter-wrap .ui-dropmenu-label');
          if (!label) return JSON.stringify({ok: false, error: 'job selector not found'});
          label.click();
          return JSON.stringify({ok: true});
        })()
      `);
      const openedResult = parseBrowserResult(opened);
      if (!openedResult?.ok) return { success: false, reason: openedResult?.error || '岗位选择器未找到' };

      await this._sleep(800);
      const selected = await this._inFrame(`
        (() => {
          var targetTitle = ${JSON.stringify(jobTitle || '')};
          var norm = function(s) {
            return String(s || '')
              .split('【').join('[').split('（').join('(').split('）').join(')')
              .replace(/\\s+/g, '');
          };
          var target = norm(targetTitle);
          // 核心岗位名：去掉城市/薪资/括号备注，用于兜底匹配
          var core = norm(targetTitle.split(/[_【]/)[0]);
          var nodes = Array.from(doc.querySelectorAll('.job-selecter-wrap li, .job-selecter-wrap [role="option"], .job-selecter-wrap .job-item, .ui-dropmenu-item'));
          var option = nodes.find(function(el) {
            return norm(el.innerText) === target;
          }) || nodes.find(function(el) {
            return norm(el.innerText).includes(target) || target.includes(norm(el.innerText));
          }) || nodes.find(function(el) {
            var t = norm(el.innerText);
            return core && t.indexOf(core) === 0;
          });
          if (!option) return JSON.stringify({ok: false, error: '岗位选项未找到', nodeCount: nodes.length, nodeTexts: nodes.slice(0, 8).map(function(el){ return (el.innerText || '').trim(); }), target: target, core: core});
          option.click();
          return JSON.stringify({ok: true, title: option.innerText.trim()});
        })()
      `);
      const selectedResult = parseBrowserResult(selected);
      if (!selectedResult?.ok) {
        const diag = selectedResult && typeof selectedResult === 'object'
          ? ` [nodes=${(selectedResult as any).nodeCount ?? '?'} texts=${JSON.stringify((selectedResult as any).nodeTexts ?? [])} core=${(selectedResult as any).core ?? '?'} raw=${JSON.stringify(selected).slice(0, 200)}]`
          : ` [raw=${JSON.stringify(selected).slice(0, 200)}]`;
        return { success: false, reason: (selectedResult?.error || '岗位选择失败') + diag };
      }

      await this._sleep(700);
      const hasFilters = Object.entries(filters || {}).some(([key, value]) => {
        if (key === 'ageMin' || key === 'ageMax') return Boolean(value);
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
      });
      if (hasFilters) {
        const panel = await this._openFilterPanel();
        if (!panel?.ok) return { success: false, reason: panel?.error || 'filter panel not opened' };
        await this._sleep(FILTER_SETTLE_MS);
      }
      const filterResults: Record<string, BrowserResult[]> = {};
      const definitions: Record<string, string[]> = {
        location: ['城市', '地区', '工作城市'],
        activity: ['活跃度'],
        gender: ['性别'],
        keywords: ['牛人关键词'],
        recentViewed: ['近期没有看过'],
        resumeExchange: ['是否与同事交换简历'],
        schools: ['院校'],
        majors: ['专业'],
        jobChangeFrequency: ['跳槽频率'],
        jobIntent: ['求职意向'],
        educationRequirements: ['学历要求'],
        experienceRequirements: ['经验要求'],
        salary: ['薪资待遇'],
      };

      if (filters.ageMin || filters.ageMax) {
        filterResults.age = [await this._applyAgeRange(filters.ageMin ?? '', filters.ageMax ?? '')];
      }

      for (const [key, value] of Object.entries(filters || {})) {
        if (key === 'ageMin' || key === 'ageMax') continue;
        if (!value || !definitions[key]) continue;
        const values = Array.isArray(value) ? value : [value];
        if (!values.length) continue;
        filterResults[key] = [];
        for (const option of values) {
          if (!option || option === '不限' && key === 'keywords') continue;
          filterResults[key].push(await this._applyFilter(definitions[key], String(option)));
        }
      }

      const failed = Object.entries(filterResults).filter(([, results]) => results.some(result => !result?.ok));
      if (failed.length) {
        const names = failed.map(([key]) => key).join(', ');
        const details = failed.map(([key, results]) => {
          const failedResult = results.find(result => !result?.ok);
          return `${key}: ${failedResult?.error || 'unknown error'}`;
        }).join('; ');
        this.logger.error(`BOSS 筛选条件未应用: ${names}`);
        return { success: false, reason: `筛选条件未应用: ${details}`, filters: filterResults };
      }
      if (hasFilters) {
        const applied = await this._applyFilterPanel();
        if (!applied?.ok) return { success: false, reason: applied?.error || 'filter apply failed', filters: filterResults };
      }
      return { success: true, job: selectedResult.title, filters: filterResults };
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      this.logger.error(`自动设置岗位和筛选条件失败: ${err.message}`);
      return { success: false, reason: err.message };
    }
  }

  private async _openFilterPanelLegacy(): Promise<BrowserResult> {
    const result = await this._inFrame(`
      (() => {
        var visible = function(el) {
          if (!el || el.hidden) return false;
          var style = doc.defaultView.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        };
        var filterText = ['年龄', '活跃度', '求职意向'];
        var panelOpen = filterText.every(function(text) {
          return Array.from(doc.querySelectorAll('body *')).some(function(el) {
            return visible(el) && el.children.length === 0 && (el.innerText || '').trim() === text;
          });
        });
        if (panelOpen) return JSON.stringify({ok: true, method: 'already-open'});
        var buttons = Array.from(doc.querySelectorAll('button, [role="button"], a, li, span'));
        var button = buttons.find(function(el) {
          var text = (el.innerText || '').trim();
          return visible(el) && (text === '筛选条件' || text === '筛选');
        });
        if (!button) return JSON.stringify({ok: false, error: '筛选条件入口未找到'});
        button.click();
        return JSON.stringify({ok: true, method: 'opened'});
      })()
    `);
    const parsed = parseBrowserResult(result);
    if (!parsed?.ok) this.logger.warn(`筛选面板未打开: ${parsed?.error || 'unknown'}`);
    return parsed || {ok: false};
  }

  private async _applyFilterLegacy(labels: string[], value: string): Promise<BrowserResult> {
    const result = await this._inFrame(`
      (() => {
        var labels = ${JSON.stringify(labels)};
        var value = ${JSON.stringify(value)};
        var lower = function(text) { return (text || '').trim().toLowerCase(); };
        var visible = function(el) {
          if (!el || el.hidden) return false;
          var style = doc.defaultView.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        };
        var input = Array.from(doc.querySelectorAll('input')).find(function(el) {
          var text = [el.placeholder, el.getAttribute('aria-label'), el.title].join(' ');
          return visible(el) && labels.some(function(label) { return text.includes(label); });
        });
        if (input) {
          var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', {bubbles: true}));
          input.dispatchEvent(new Event('change', {bubbles: true}));
          input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true}));
          input.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', code: 'Enter', bubbles: true}));
          return JSON.stringify({ok: true, method: 'input'});
        }
        var clickableNodes = Array.from(doc.querySelectorAll('button, li, span, div, a, [role="button"], .filter-condition, .filter-item'));
        var exactMatches = clickableNodes.filter(function(el) {
          var text = lower(el.innerText);
          return visible(el) && labels.some(function(label) { return text === lower(label); });
        });
        var containsMatches = clickableNodes.filter(function(el) {
          var text = lower(el.innerText);
          return visible(el) && labels.some(function(label) { return text.includes(lower(label)); });
        });
        exactMatches.sort(function(a, b) { return (a.innerText || '').length - (b.innerText || '').length; });
        containsMatches.sort(function(a, b) { return (a.innerText || '').length - (b.innerText || '').length; });
        var clickable = exactMatches[0] || containsMatches[0];
        if (!clickable) return JSON.stringify({ok: false, error: 'filter control not found'});
        clickable.click();
        return JSON.stringify({ok: true, method: 'dropdown', opened: clickable.innerText.trim()});
      })()
    `);
    const parsed = parseBrowserResult(result);
    if (!parsed?.ok || parsed.method !== 'dropdown') return parsed || {ok: false};

    await this._sleep(500);
    const optionResult = await this._inFrame(`
      (() => {
        var target = ${JSON.stringify(value)};
        var normalize = function(text) { return (text || '').replace(/\\s+/g, ' ').trim().toLowerCase(); };
        var normalizedTarget = normalize(target);
        var nodes = Array.from(doc.querySelectorAll('li, button, span, div, a, [role="option"], .ui-dropmenu-item, .filter-option'));
        var visible = function(el) {
          if (!el || el.hidden) return false;
          var style = doc.defaultView.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        };
        var exactOptions = nodes.filter(function(el) { return visible(el) && normalize(el.innerText) === normalizedTarget; });
        var containsOptions = nodes.filter(function(el) { return visible(el) && normalize(el.innerText).includes(normalizedTarget); });
        exactOptions.sort(function(a, b) { return (a.innerText || '').length - (b.innerText || '').length; });
        containsOptions.sort(function(a, b) { return (a.innerText || '').length - (b.innerText || '').length; });
        var option = exactOptions[0] || containsOptions[0];
        if (!option) return JSON.stringify({ok: false, error: 'filter option not found'});
        option.click();
        return JSON.stringify({ok: true, option: option.innerText.trim()});
      })()
    `);
    const optionParsed = parseBrowserResult(optionResult);
    await this._sleep(this.actionDelayMs());
    return optionParsed || {ok: false};
  }

  private async _applyAgeRangeLegacy(minValue: string | number, maxValue: string | number): Promise<BrowserResult> {
    const result = await this._inFrame(`
      (() => {
        var minValue = ${JSON.stringify(String(minValue || ''))};
        var maxValue = ${JSON.stringify(String(maxValue || ''))};
        var ranges = Array.from(doc.querySelectorAll('input[type="range"]'));
        if (ranges.length < 2) return JSON.stringify({ok: false, error: '年龄范围控件未找到'});
        var setValue = function(input, value) {
          if (!value) return;
          var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', {bubbles: true}));
          input.dispatchEvent(new Event('change', {bubbles: true}));
        };
        setValue(ranges[0], minValue);
        setValue(ranges[1], maxValue);
        return JSON.stringify({ok: true, method: 'range'});
      })()
    `);
    const parsed = parseBrowserResult(result);
    if (parsed?.ok) await this._sleep(FILTER_SETTLE_MS);
    return parsed || {ok: false};
  }

  // BOSS's filter panel is rendered in the search iframe. Keep these methods
  // scoped to the panel so similarly named elements elsewhere cannot be clicked.
  private async _openFilterPanel(): Promise<BrowserResult> {
    const result = await this._inFrame(`
      (() => {
        var panel = doc.querySelector('.filter-panel');
        var visible = function(el) {
          if (!el || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
          var style = doc.defaultView.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0;
        };
        if (visible(panel)) return JSON.stringify({ok: true, method: 'already-open'});
        var entry = doc.querySelector('.filter-label-wrap');
        if (!entry) return JSON.stringify({ok: false, error: 'filter entry not found'});
        entry.click();
        return JSON.stringify({ok: true, method: 'opened'});
      })()
    `);
    const parsed = parseBrowserResult(result);
    return parsed || {ok: false};
  }

  private async _applyFilter(labels: string[], value: string): Promise<BrowserResult> {
    const result = await this._inFrame(`
      (() => {
        var labels = ${JSON.stringify(labels)};
        var value = ${JSON.stringify(value)};
        var normalize = function(text) { return (text || '').replace(/\\s+/g, ' ').trim().toLowerCase(); };
        var visible = function(el) {
          if (!el || el.hidden) return false;
          var style = doc.defaultView.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0;
        };
        var item = Array.from(doc.querySelectorAll('.filter-item')).find(function(el) {
          var name = el.querySelector('.name');
          var text = name ? normalize(name.innerText) : '';
          return labels.some(function(label) { return text === normalize(label) || text.includes(normalize(label)); });
        });
        if (!item) return JSON.stringify({ok: false, error: 'filter item not found'});
        var target = normalize(value);
        var option = Array.from(item.querySelectorAll('.option')).filter(visible)
          .find(function(el) { return normalize(el.innerText) === target; });
        if (!option) return JSON.stringify({ok: false, error: 'filter option not found: ' + value});
        option.click();
        return JSON.stringify({ok: true, option: option.innerText.trim()});
      })()
    `);
    const parsed = parseBrowserResult(result);
    if (parsed?.ok) await this._sleep(FILTER_SETTLE_MS);
    return parsed || {ok: false};
  }

  private async _applyFilterPanel(): Promise<BrowserResult> {
    const result = await this._inFrame(`
      (() => {
        var panel = doc.querySelector('.filter-panel');
        if (!panel) return JSON.stringify({ok: false, error: 'filter panel not found'});
        var apply = Array.from(panel.querySelectorAll('button, a, .btn, [role="button"]'))
          .find(function(el) { return ['应用', '确定'].includes((el.innerText || '').trim()); });
        if (!apply) return JSON.stringify({ok: false, error: 'apply button not found'});
        apply.click();
        return JSON.stringify({ok: true});
      })()
    `);
    const parsed = parseBrowserResult(result);
    if (parsed?.ok) await this._sleep(FILTER_SETTLE_MS);
    return parsed || {ok: false};
  }

  private async _applyAgeRange(minValue: string | number, maxValue: string | number): Promise<BrowserResult> {
    const result = await this._inFrame(`
      (() => {
        var minValue = ${JSON.stringify(String(minValue || ''))};
        var maxValue = ${JSON.stringify(String(maxValue || ''))};
        var slider = doc.querySelector('.filter-item.age .vue-slider');
        var vm = slider && slider.__vue__;
        if (!slider || !vm || typeof vm.setValue !== 'function') return JSON.stringify({ok: false, error: 'age slider not found'});
        var current = typeof vm.getValue === 'function' ? vm.getValue() : [16, 46];
        var min = minValue ? Number(minValue) : Number(current[0]);
        var max = maxValue ? Number(maxValue) : Number(current[1]);
        if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return JSON.stringify({ok: false, error: 'invalid age range'});
        vm.setValue([min, max]);
        var finalValue = typeof vm.getValue === 'function' ? vm.getValue() : null;
        var ok = Array.isArray(finalValue) && Number(finalValue[0]) === min && Number(finalValue[1]) === max;
        return JSON.stringify({ok: ok, method: 'vue-slider-setValue', value: finalValue, expected: [min, max]});
      })()
    `);
    const parsed = parseBrowserResult(result);
    if (parsed?.ok) await this._sleep(FILTER_SETTLE_MS);
    return parsed || {ok: false};
  }

  async closeDetail(): Promise<boolean> {
    this.logger.action('关闭详情面板');
    const maxAttempts = 3;
    let closeClicked = false;

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const result = await this._inFrame(`
          (() => {
            var isVisible = function(el) {
              if (!el || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
              var classes = String(el.className || '').toLowerCase();
              var toks = classes.split(/\\s+/);
              var badTokens = {hidden:1, hide:1, closed:1, closing:1, leave:1, 'v-leave':1, 'v-leave-active':1, 'fade-leave':1, 'fade-leave-active':1};
              for (var ti = 0; ti < toks.length; ti++) { if (badTokens[toks[ti]]) return false; }
              var style = doc.defaultView.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' &&
                style.opacity !== '0' && style.pointerEvents !== 'none' &&
                (el.offsetWidth > 0 || el.offsetHeight > 0);
            };
            var detailSelectors = [
              '.boss-popup__wrapper', '.boss-dialog', '.resume-detail',
              '.resume-detail-container', '.geek-detail', '.detail-wrap'
            ];
            var detail = null;
            for (var selector of detailSelectors) {
              var candidate = doc.querySelector(selector);
              if (isVisible(candidate)) { detail = candidate; break; }
            }
            if (!detail) return JSON.stringify({closed: true, method: 'already-closed'});

            // Mark the specific detail so later checks only track this element,
            // not any other BOSS popup that happens to be on the page.
            detail.setAttribute('data-dzh-detail', '1');

            if (!${closeClicked}) {
              // Search for close button scoped inside the marked detail first,
              // then fall back to page-level for edge cases where button is portal-rendered.
              var btnSelectors = [
                '.close-btn', '.icon-close', 'i.iboss-close'
              ];
              for (var i = 0; i < btnSelectors.length; i++) {
                var btn = detail.querySelector(btnSelectors[i]);
                if (isVisible(btn)) {
                  btn.click();
                  return JSON.stringify({closed: false, clicked: true, method: 'detail-scoped ' + btnSelectors[i]});
                }
              }
              // Fallback: page-level close buttons
              var pageSelectors = [
                '.boss-popup__wrapper .close-btn', '.boss-dialog .close-btn',
                '.boss-popup__wrapper .icon-close', '.boss-dialog .icon-close',
                'i.iboss-close', '.resume-detail .close-btn',
                '.resume-detail-container .close-btn', '.geek-detail .close-btn'
              ];
              for (var j = 0; j < pageSelectors.length; j++) {
                var pageBtn = doc.querySelector(pageSelectors[j]);
                if (isVisible(pageBtn)) {
                  pageBtn.click();
                  return JSON.stringify({closed: false, clicked: true, method: pageSelectors[j]});
                }
              }
            }
            return JSON.stringify({closed: false, clicked: false, waiting: true,
              dbgCls: String(detail.className||''), dbgDisplay: doc.defaultView.getComputedStyle(detail).display,
              dbgOpacity: doc.defaultView.getComputedStyle(detail).opacity});
          })()
        `);

        const parsed = parseBrowserResult(result);

        if (parsed?.closed) return true;
        if (parsed?.clicked) closeClicked = true;

        await this._sleep(1200 + attempt * 700);
        const state = await this._inFrame(`
          (() => {
            var isVisible = function(el) {
              if (!el || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
              var classes = String(el.className || '').toLowerCase();
              var toks = classes.split(/\\s+/);
              var badTokens = {hidden:1, hide:1, closed:1, closing:1, leave:1, 'v-leave':1, 'v-leave-active':1, 'fade-leave':1, 'fade-leave-active':1};
              for (var ti = 0; ti < toks.length; ti++) { if (badTokens[toks[ti]]) return false; }
              var style = doc.defaultView.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' &&
                style.opacity !== '0' && style.pointerEvents !== 'none' &&
                (el.offsetWidth > 0 || el.offsetHeight > 0);
            };
            // Only check the specific detail element we marked — ignore other popups.
            var detail = doc.querySelector('[data-dzh-detail="1"]');
            return JSON.stringify({open: detail ? isVisible(detail) : false});
          })()
        `);
        const stateParsed = parseBrowserResult(state);
        if (!stateParsed?.open) return true;

        this.logger.warn(`详情面板仍未关闭，第 ${attempt}/${maxAttempts} 次重试`);
      }

      // Some BOSS dialogs ignore a synthetic click; use the browser-level Escape as a final fallback.
      await this.bw.press('Escape');
      await this._sleep(1000);
      const finalState = await this._inFrame(`
        (() => {
          var isVisible = function(el) {
            if (!el || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
            var classes = String(el.className || '').toLowerCase();
            var toks = classes.split(/\\s+/);
            var badTokens = {hidden:1, hide:1, closed:1, closing:1, leave:1, 'v-leave':1, 'v-leave-active':1, 'fade-leave':1, 'fade-leave-active':1};
            for (var ti = 0; ti < toks.length; ti++) { if (badTokens[toks[ti]]) return false; }
            var style = doc.defaultView.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' &&
              style.opacity !== '0' && style.pointerEvents !== 'none' &&
              (el.offsetWidth > 0 || el.offsetHeight > 0);
          };
          // Only check the specific detail element we marked.
          var detail = doc.querySelector('[data-dzh-detail="1"]');
          if (!detail) return JSON.stringify({open: false});
          // Vue transition stuck: v-leave-active with pointer-events=auto = panel invisible but DOM残留
          var cls = String(detail.className || '').toLowerCase();
          var toks = cls.split(/\\s+/);
          var stuckLeave = false;
          for (var ti = 0; ti < toks.length; ti++) {
            if (toks[ti] === 'v-leave-active' || toks[ti] === 'fade-leave-active') { stuckLeave = true; break; }
          }
          if (stuckLeave) {
            var st = doc.defaultView.getComputedStyle(detail);
            // If pointer-events=auto while in v-leave → animation stuck, panel effectively closed
            if (st.pointerEvents === 'auto') return JSON.stringify({open: false, reason: 'stuck-leave'});
          }
          var st = doc.defaultView.getComputedStyle(detail);
          return JSON.stringify({open: isVisible(detail),
            dbgCls: cls, dbgDisplay: st.display,
            dbgOpacity: st.opacity, dbgPE: st.pointerEvents, dbgW: detail.offsetWidth, dbgH: detail.offsetHeight});
        })()
      `);
      const finalParsed = parseBrowserResult(finalState);
      if (!finalParsed?.open) return true;

      this.logger.error(`详情面板无法关闭，停止后续操作 [cls=${finalParsed?.dbgCls ?? '?'} display=${finalParsed?.dbgDisplay ?? '?'} opacity=${finalParsed?.dbgOpacity ?? '?'} pe=${finalParsed?.dbgPE ?? '?'} ${finalParsed?.dbgW ?? '?'}x${finalParsed?.dbgH ?? '?'}]`);
      return false;
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      this.logger.warn(`关闭详情面板失败: ${err.message}`);
      return false;
    }
  }

  async goBack(): Promise<boolean> {
    // BOSS直聘 split-panel: clicking another card replaces the detail
    // No explicit "back" needed
    return true;
  }

  async hasNextPage(): Promise<boolean> {
    // BOSS 使用无限滚动
    return false;
  }

  async nextPage(): Promise<boolean> {
    return this.scrollToLoadMore();
  }

  async scrollToLoadMore(): Promise<boolean> {
    this.logger.action('滚动加载更多牛人');
    try {
      // 记录当前卡片数，检测滚动是否能加载新卡片
      const before = await this._inFrame(`
        (() => {
          var items = doc.querySelectorAll('ul.card-list > li.card-item');
          var sh = doc.documentElement.scrollHeight;
          var st = doc.defaultView.scrollY || doc.defaultView.pageYOffset || doc.documentElement.scrollTop;
          var ih = doc.defaultView.innerHeight;
          return JSON.stringify({count: items.length, scrollHeight: sh, scrollTop: st, innerHeight: ih});
        })()
      `);
      const beforeParsed = parseBrowserResult(before);
      const beforeCount = typeof beforeParsed?.count === 'number' ? beforeParsed.count : 0;
      const scrollHeight = typeof beforeParsed?.scrollHeight === 'number' ? beforeParsed.scrollHeight : 0;
      const innerHeight = typeof beforeParsed?.innerHeight === 'number' ? beforeParsed.innerHeight : 0;

      // 逐步滚动到接近底部，检测卡片数增长或到底
      const steps = 3;
      let loaded = false;
      for (let step = 1; step <= steps; step++) {
        const targetY = Math.min(
          (scrollHeight - innerHeight) * (step / steps),
          scrollHeight - innerHeight + 200 // overshoot slightly to trigger lazy load
        );
        await this._inFrame(`
          (() => {
            doc.defaultView.scrollTo(0, ${Math.max(0, targetY)});
            return JSON.stringify({ok: true});
          })()
        `);
        await this._sleep(step < steps ? 1200 : 2000);

        // 检查卡片数是否增加
        const after = await this._inFrame(`
          (() => {
            var items = doc.querySelectorAll('ul.card-list > li.card-item');
            var st = doc.defaultView.scrollY || doc.defaultView.pageYOffset;
            var sh = doc.documentElement.scrollHeight;
            return JSON.stringify({count: items.length, scrollTop: st, scrollHeight: sh});
          })()
        `);
        const afterParsed = parseBrowserResult(after);
        const afterCount = typeof afterParsed?.count === 'number' ? afterParsed.count : 0;
        if (afterCount > beforeCount) {
          this.logger.info(`滚动加载: ${beforeCount} → ${afterCount} 张卡 (step ${step}/${steps})`);
          loaded = true;
          break;
        }
        // Scroll height increased = more content loaded even if cards not rendered yet
        const afterSH = typeof afterParsed?.scrollHeight === 'number' ? afterParsed.scrollHeight : scrollHeight;
        if (afterSH > scrollHeight + 100) {
          this.logger.info(`滚动触发内容增长: ${scrollHeight} → ${afterSH} (可能未渲染完)`);
          loaded = true;
          break;
        }
      }
      if (!loaded) this.logger.info(`滚动完成，卡片数无变化`);
      return true;
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      this.logger.error(`滚动加载失败: ${err.message}`);
      return false;
    }
  }

  // 点击卡片上的直接打招呼按钮（不经过详情侧面板）
  async quickGreet(card: CandidateCard): Promise<boolean> {
    this.logger.action(`快速打招呼: ${card.name}`);
    try {
      const result = await this._inFrame(`
        (() => {
          const cards = doc.querySelectorAll('ul.card-list > li.card-item');
          if (!cards[${card.index}]) return JSON.stringify({ok: false, error: 'no card'});
          const btn = cards[${card.index}].querySelector('.btn-greet');
          if (!btn) return JSON.stringify({ok: false, error: 'no greet btn'});
          btn.click();
          return JSON.stringify({ok: true});
        })()
      `);
      return parseBrowserResult(result).ok === true;
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      this.logger.error(`快速打招呼失败: ${err.message}`);
      return false;
    }
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default Scanner;
