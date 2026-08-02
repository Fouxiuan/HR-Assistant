import { useCallback, useEffect, useState } from 'react';
import type { MailConfigPublic } from '@shared/contracts';
import { api, ApiError } from '../../api/client';
import { LoadingState } from '../../components/States';

type Provider = MailConfigPublic['provider'];

interface AIProviderItem {
  key: string;
  label: string;
  baseUrl: string;
}

interface MailSettingsConfig extends MailConfigPublic {
  aiProviders: AIProviderItem[];
}

const providerPresets: Record<Provider, { label: string; host: string; port: number; secure: boolean }> = {
  '163': { label: '网易 163', host: 'imap.163.com', port: 993, secure: true },
  '126': { label: '网易 126', host: 'imap.126.com', port: 993, secure: true },
  '188': { label: '网易 188', host: 'imap.188.com', port: 993, secure: true },
  vip163: { label: '网易 VIP 163', host: 'imap.vip.163.com', port: 993, secure: true },
  vip126: { label: '网易 VIP 126', host: 'imap.vip.126.com', port: 993, secure: true },
  'netease-enterprise': { label: '网易企业邮箱', host: 'imap.qiye.163.com', port: 993, secure: true },
};

const aiProviderPresets: AIProviderItem[] = [
  { key: 'ollama', label: 'Ollama（本机）', baseUrl: 'http://127.0.0.1:11434/v1' },
  { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { key: 'doubao', label: '豆包 (火山引擎)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { key: 'dashscope', label: '阿里云百炼 (通义千问)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { key: 'kimi', label: 'Kimi (月之暗面)', baseUrl: 'https://api.moonshot.cn' },
  { key: 'zhipu', label: '智谱 AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { key: 'custom', label: '自定义', baseUrl: '' },
];

const emptyMailConfig: MailSettingsConfig = {
  provider: '163',
  maskedUsername: '',
  host: providerPresets['163'].host,
  port: providerPresets['163'].port,
  secure: providerPresets['163'].secure,
  mailbox: 'INBOX',
  enabled: false,
  hasSecret: false,
  aiProvider: 'deepseek',
  aiBaseUrl: 'https://api.deepseek.com',
  aiModel: '',
  hasAIKey: false,
  aiProviders: aiProviderPresets,
};

export function MailSettingsPanel({ requiresRebaseline = false, onChanged }: { requiresRebaseline?: boolean; onChanged(): void }) {
  const [config, setConfig] = useState<MailSettingsConfig | null>(null);
  const [access, setAccess] = useState<'loading' | 'allowed' | 'restricted' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [username, setUsername] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [aiFeedback, setAiFeedback] = useState('');
  const [modelList, setModelList] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState('');

  const load = useCallback(async () => {
    setAccess('loading');
    try {
      const value = await api<MailSettingsConfig | null>('/api/mail/admin/config');
      setConfig(value ? { ...value, aiProviders: value.aiProviders?.length ? value.aiProviders : aiProviderPresets } : { ...emptyMailConfig });
      setAccess('allowed');
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setAccess('restricted');
      } else if (error instanceof ApiError && error.status === 404) {
        setConfig({ ...emptyMailConfig });
        setAccess('allowed');
      } else {
        setLoadError(error instanceof Error ? error.message : String(error));
        setAccess('error');
      }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const persist = async (rebaseline = false): Promise<MailSettingsConfig> => {
    if (!config) throw new Error('邮箱配置尚未读取完成');
    const saved = await api<MailSettingsConfig>('/api/mail/admin/config', {
      method: 'PUT',
      body: JSON.stringify({
        provider: config.provider,
        username: username.trim() || undefined,
        host: config.host,
        port: config.port,
        secure: config.secure,
        mailbox: config.mailbox,
        enabled: config.enabled,
        aiProvider: config.aiProvider,
        aiBaseUrl: config.aiBaseUrl,
        aiModel: config.aiModel,
        authCode: authCode.trim() || undefined,
        aiApiKey: aiApiKey.trim() || undefined,
        rebaseline,
      }),
    });
    const normalized = { ...saved, aiProviders: saved.aiProviders?.length ? saved.aiProviders : config.aiProviders };
    setConfig(normalized);
    setUsername('');
    setAuthCode('');
    setAiApiKey('');
    onChanged();
    return normalized;
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFeedback(null);
    try { await action(); } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : String(error), ok: false });
    } finally { setBusy(false); }
  };

  if (access === 'loading') return <LoadingState label="正在读取邮箱配置…" />;
  if (access === 'restricted') {
    return (
      <section className="card mail-config-access">
        <span className="mail-config-lock" aria-hidden="true">锁</span>
        <div><h2>邮箱设置仅允许本机访问</h2><p>请从 HR筛选简历助手本机界面打开此页面。</p></div>
      </section>
    );
  }
  if (access === 'error' || !config) {
    return <section className="state-card danger" role="alert">{loadError || '邮箱配置读取失败'} <button className="button secondary small" onClick={() => void load()}>重新读取</button></section>;
  }

  const changeProvider = (provider: Provider) => {
    const preset = providerPresets[provider];
    setConfig({ ...config, provider, host: preset.host, port: preset.port, secure: preset.secure });
  };

  const changeAIProvider = (provider: string) => {
    const preset = config.aiProviders.find((item) => item.key === provider);
    setConfig({ ...config, aiProvider: provider, aiBaseUrl: preset?.baseUrl || config.aiBaseUrl, aiModel: '' });
    setModelList([]);
    setModelError('');
    setAiFeedback('');
  };

  const fetchModels = async () => {
    setLoadingModels(true);
    setModelError('');
    setAiFeedback('');
    try {
      const result = await api<{ ok: boolean; message?: string; models?: string[] }>('/api/mail/admin/models', {
        method: 'POST',
        body: JSON.stringify({
          aiProvider: config.aiProvider,
          aiBaseUrl: config.aiBaseUrl.trim(),
          aiApiKey: aiApiKey.trim() || undefined,
        }),
      });
      if (result.ok && result.models?.length) {
        setModelList(result.models);
        setAiFeedback(`获取到 ${result.models.length} 个模型`);
      } else {
        setModelError(result.message || '未获取到可用模型');
      }
    } catch (error) {
      setModelError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingModels(false);
    }
  };

  const isCustomAI = config.aiProvider === 'custom';
  const aiNeedsKey = config.aiProvider !== 'ollama';

  return (
    <div className="mail-settings-stack">
      <section className="card mail-config-intro">
        <div><span>本机邮箱</span><h2>{config.enabled ? '自动收取已启用' : '等待启用'}</h2><p>保存并启用后，每分钟检查启用时间之后收到的新 BOSS PDF 简历。</p></div>
        <label className="mail-switch"><input name="mail-enabled" type="checkbox" checked={config.enabled} onChange={(event) => setConfig({ ...config, enabled: event.target.checked })} /><span aria-hidden="true" /><strong>{config.enabled ? '已启用' : '未启用'}</strong></label>
      </section>

      {feedback ? <div className={feedback.ok ? 'settings-feedback success' : 'settings-feedback error'} role={feedback.ok ? 'status' : 'alert'} aria-live="polite">{feedback.text}</div> : null}

      <section className="card form-card mail-config">
        <div className="mail-section-title"><h2>邮箱连接</h2><p>使用网易客户端授权码，不是邮箱登录密码。已有密钥留空即可保留。</p></div>
        <div className="field-grid three">
          <label>邮箱类型
            <select name="mail-provider" autoComplete="off" value={config.provider} onChange={(event) => changeProvider(event.target.value as Provider)}>
              {Object.entries(providerPresets).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}
            </select>
          </label>
          <label>邮箱账号<input name="mail-username" type="email" inputMode="email" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} placeholder={config.maskedUsername || '例如：hr@example.com…'} autoComplete="username" /></label>
          <label>客户端授权码<input name="mail-auth-code" type="password" spellCheck={false} value={authCode} onChange={(event) => setAuthCode(event.target.value)} placeholder={config.hasSecret ? '••••••••（留空不修改）' : '请输入客户端授权码…'} autoComplete="new-password" /></label>
        </div>
        <details className="mail-advanced">
          <summary>高级 IMAP 设置</summary>
          <div className="field-grid three">
            <label>IMAP 主机<input name="imap-host" autoComplete="off" spellCheck={false} value={config.host} onChange={(event) => setConfig({ ...config, host: event.target.value })} /></label>
            <label>端口<input name="imap-port" autoComplete="off" type="number" min={1} max={65535} value={config.port} onChange={(event) => setConfig({ ...config, port: Number(event.target.value) })} /></label>
            <label>邮箱文件夹<input name="imap-mailbox" autoComplete="off" spellCheck={false} value={config.mailbox} onChange={(event) => setConfig({ ...config, mailbox: event.target.value })} placeholder="例如：INBOX…" /></label>
          </div>
          <label className="mail-check"><input name="imap-secure" type="checkbox" checked={config.secure} onChange={(event) => setConfig({ ...config, secure: event.target.checked })} />使用 SSL/TLS 安全连接</label>
        </details>
      </section>

      <section className="card form-card mail-config">
        <div className="mail-section-title"><h2>简历识别 AI</h2><p>配置方式与设置中的 AI 配置一致，但模型与密钥仍单独保存，仅用于邮件岗位分类和评分。</p></div>
        <div className="field-grid two">
          <label>提供商
            <select name="mail-ai-provider" autoComplete="off" value={config.aiProvider} onChange={(event) => changeAIProvider(event.target.value)}>
              {config.aiProviders.map((provider) => <option key={provider.key} value={provider.key}>{provider.label}</option>)}
            </select>
          </label>
          <label>Base URL<input name="mail-ai-base-url" type="url" autoComplete="off" spellCheck={false} value={config.aiBaseUrl} onChange={(event) => setConfig({ ...config, aiBaseUrl: event.target.value })} placeholder="例如：https://api.deepseek.com…" /></label>
        </div>
        <div className="field-grid two settings-ai-fields">
          <label>{aiNeedsKey ? 'API Key' : 'API Key（Ollama 可留空）'}<input name="mail-ai-api-key" type="password" spellCheck={false} value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder={config.hasAIKey ? '••••••••（已设置，留空不修改）' : aiNeedsKey ? '请输入 API Key…' : '本机 Ollama 无需填写'} autoComplete="new-password" /></label>
          <label>模型
            {isCustomAI && modelList.length === 0 ? (
              <input name="mail-ai-model" autoComplete="off" spellCheck={false} value={config.aiModel} onChange={(event) => setConfig({ ...config, aiModel: event.target.value })} placeholder="例如：qwen3:8b…" />
            ) : (
              <select name="mail-ai-model" autoComplete="off" value={config.aiModel} onChange={(event) => setConfig({ ...config, aiModel: event.target.value })}>
                <option value="">— 请选择模型 —</option>
                {config.aiModel && !modelList.includes(config.aiModel) ? <option value={config.aiModel}>{config.aiModel}</option> : null}
                {modelList.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            )}
          </label>
        </div>
        <div className="button-row">
          <button className="button secondary" onClick={() => void fetchModels()} disabled={(aiNeedsKey && !config.hasAIKey && !aiApiKey.trim()) || loadingModels}>{loadingModels ? '获取中…' : '获取模型列表'}</button>
          <button className="button secondary" disabled={busy} onClick={() => void run(async () => { await persist(); await api('/api/mail/admin/test-ai', { method: 'POST', body: '{}' }); setAiFeedback('✓ 连接成功'); })}>测试 AI 连接</button>
          {aiFeedback ? <span className="form-feedback" role="status" aria-live="polite">{aiFeedback}</span> : null}
        </div>
        {modelError ? <p className="settings-inline-error" role="alert">{modelError}</p> : null}
      </section>

      <section className="mail-config-actions">
        <div><strong>授权码与 AI Key 会在本机单独加密保存</strong><small>应用不会把这些密钥上传到其他服务。</small></div>
        <div className="button-row">
          {requiresRebaseline ? <button className="button danger" disabled={busy} onClick={() => { if (window.confirm('重新建立基线后只会读取新基线之后的邮件，确定继续吗？')) void run(async () => { await persist(true); setFeedback({ text: '邮箱基线已重新建立', ok: true }); }); }}>重新建立基线</button> : null}
          <button className="button secondary" disabled={busy} onClick={() => void run(async () => { await persist(); await api('/api/mail/admin/test-imap', { method: 'POST', body: '{}' }); setFeedback({ text: '邮箱配置已保存，IMAP 连接成功', ok: true }); })}>保存并测试邮箱</button>
          <button className="button primary" disabled={busy} onClick={() => void run(async () => { await persist(); setFeedback({ text: '邮箱与 AI 配置已保存', ok: true }); })}>{busy ? '处理中…' : '保存邮箱设置'}</button>
        </div>
      </section>
    </div>
  );
}
