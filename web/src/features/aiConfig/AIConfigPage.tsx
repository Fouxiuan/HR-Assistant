import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useFetch } from '../../api/useFetch';
import { post } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/States';
import type { SettingsSectionHandle, SettingsSectionProps } from '../settings/section';

interface AIProviderItem { key: string; label: string; baseUrl: string }
interface AIConfigData { provider: string; apiKey: string; model: string; baseUrl: string; hasKey: boolean; providers: AIProviderItem[] }
interface TestResult { ok: boolean; latency: number; message: string }

export const AIConfigPage = forwardRef<SettingsSectionHandle, SettingsSectionProps>(function AIConfigPage({ embedded = false, onDirtyChange }, ref) {
  const { data, mutate } = useFetch<AIConfigData>('/api/ai-config');
  const [draft, setDraft] = useState<AIConfigData | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [feedback, setFeedback] = useState('');
  const [modelList, setModelList] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => { if (data) setDraft(data); }, [data]);
  useEffect(() => onDirtyChange?.(Boolean(data && draft && (apiKeyInput.trim() || JSON.stringify(data) !== JSON.stringify(draft)))), [apiKeyInput, data, draft, onDirtyChange]);

  const save = useCallback(async () => {
    if (!draft) throw new Error('AI 配置尚未读取完成');
    const result = await post<AIConfigData>('/api/ai-config', {
      provider: draft.provider,
      model: draft.model,
      baseUrl: draft.baseUrl.trim(),
      apiKey: apiKeyInput.trim() || undefined,
    });
    setDraft(result);
    mutate(result);
    setApiKeyInput('');
    setFeedback('配置已保存在本机');
  }, [apiKeyInput, draft, mutate]);

  useImperativeHandle(ref, () => ({ save }), [save]);
  if (!draft) return <LoadingState label="正在读取 AI 配置…" />;

  const providerChanged = (provider: string) => {
    const selected = draft.providers.find(item => item.key === provider);
    setDraft({ ...draft, provider, baseUrl: selected?.baseUrl || draft.baseUrl, model: '' });
    setModelList([]);
  };

  const fetchModels = async () => {
    setLoadingModels(true);
    setFeedback('');
    try {
      const result = await post<{ ok: boolean; message?: string; models?: string[] }>('/api/ai-config/models', {
        apiKey: apiKeyInput.trim() || undefined,
        baseUrl: draft.baseUrl.trim(),
        provider: draft.provider,
      });
      setModelList(result.models || []);
      setFeedback(result.ok ? `获取到 ${result.models?.length || 0} 个模型` : result.message || '获取失败');
    } catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
    finally { setLoadingModels(false); }
  };

  const test = async () => {
    try {
      const result = await post<TestResult>('/api/ai-config/test', {
        apiKey: apiKeyInput.trim() || undefined,
        baseUrl: draft.baseUrl.trim(),
        model: draft.model || undefined,
        provider: draft.provider,
      });
      setFeedback(result.ok ? `连接成功（${result.latency}ms）` : result.message);
    } catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
  };

  return <>
    {!embedded ? <PageHeader eyebrow="LOCAL AI" title="AI 模型配置" description="API Key 单独加密并仅保存在本机。" actions={<button className="button primary" onClick={() => void save()}>保存配置</button>} /> : null}
    <section className="card form-card">
      <h2>模型服务</h2>
      <p className="field-help">应用只会访问这里配置的 AI 服务；未配置时继续使用内置降级评分。</p>
      <div className="field-grid two">
        <label>提供商<select name="ai-provider" value={draft.provider} onChange={event => providerChanged(event.target.value)}>{draft.providers.map(provider => <option key={provider.key} value={provider.key}>{provider.label}</option>)}</select></label>
        <label>Base URL<input name="ai-base-url" type="url" value={draft.baseUrl} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
        <label>{draft.provider === 'ollama' ? 'API Key（可留空）' : 'API Key'}<input name="ai-api-key" type="password" autoComplete="new-password" value={apiKeyInput} onChange={event => setApiKeyInput(event.target.value)} placeholder={draft.hasKey ? '已配置，留空不修改' : '输入 API Key'} /></label>
        <label>模型<select name="ai-model" value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })}><option value="">请选择模型</option>{draft.model && !modelList.includes(draft.model) ? <option value={draft.model}>{draft.model}</option> : null}{modelList.map(model => <option key={model} value={model}>{model}</option>)}</select></label>
      </div>
      <div className="button-row">
        <button className="button secondary" onClick={() => void fetchModels()} disabled={loadingModels}>{loadingModels ? '获取中…' : '获取模型列表'}</button>
        <button className="button secondary" onClick={() => void test()}>测试 AI 连接</button>
        {feedback ? <span className="form-feedback" role="status">{feedback}</span> : null}
      </div>
    </section>
  </>;
});
