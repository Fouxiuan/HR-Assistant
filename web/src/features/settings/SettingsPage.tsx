import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { JobsPage } from '../jobs/JobsPage';
import { KeywordsPage } from '../keywords/KeywordsPage';
import { AIConfigPage } from '../aiConfig/AIConfigPage';
import { RuntimeSettingsSection } from './RuntimeSettingsSection';
import { DataBackupSection } from './DataBackupSection';
import type { SettingsSectionHandle } from './section';

type SettingsSection = 'jobs' | 'keywords' | 'runtime' | 'ai' | 'data';
const sections: Array<{ id: SettingsSection; label: string; hint: string }> = [
  { id: 'jobs', label: 'JD 管理', hint: '本机岗位内容' },
  { id: 'keywords', label: '关键词', hint: '本机筛选词库' },
  { id: 'runtime', label: '运行参数', hint: '批次与条件' },
  { id: 'ai', label: 'AI 配置', hint: '模型与密钥' },
  { id: 'data', label: '数据与备份', hint: '导出与恢复' },
];
function currentSection(): SettingsSection { const query = window.location.hash.split('?', 2)[1] || ''; const requested = new URLSearchParams(query).get('section'); return sections.some(section => section.id === requested) ? requested as SettingsSection : 'jobs'; }

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>(currentSection);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const jobsRef = useRef<SettingsSectionHandle>(null); const keywordsRef = useRef<SettingsSectionHandle>(null); const runtimeRef = useRef<SettingsSectionHandle>(null); const aiRef = useRef<SettingsSectionHandle>(null);
  const [dirty, setDirty] = useState<Record<SettingsSection, boolean>>({ jobs: false, keywords: false, runtime: false, ai: false, data: false });
  const hasUnsavedChanges = Object.values(dirty).some(Boolean);
  const markDirty = useCallback((section: SettingsSection, value: boolean) => setDirty(current => current[section] === value ? current : { ...current, [section]: value }), []);
  useEffect(() => { const update = () => setActiveSection(currentSection()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => { if (!hasUnsavedChanges) return; const before = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener('beforeunload', before); return () => window.removeEventListener('beforeunload', before); }, [hasUnsavedChanges]);
  const select = (section: SettingsSection) => { setActiveSection(section); window.location.hash = `/settings?section=${section}`; };
  const saveAll = async () => {
    setSaving(true); setFeedback('正在保存本机设置…');
    const targets = [jobsRef.current, keywordsRef.current, runtimeRef.current, aiRef.current];
    try { for (const target of targets) await target?.save(); setDirty({ jobs: false, keywords: false, runtime: false, ai: false, data: false }); setFeedback('全部设置已保存在本机'); }
    catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  return <div className="settings-hub"><PageHeader eyebrow="LOCAL SETTINGS" title="设置" description="管理本机 JD、筛选规则、运行参数、AI 与加密备份。" actions={<button className="button primary settings-save" disabled={saving} onClick={() => void saveAll()}>{saving ? '正在保存…' : '保存全部设置'}</button>} />
    <nav className="settings-nav" aria-label="设置分类"><div className="settings-nav-track" role="tablist">{sections.map(section => <button key={section.id} id={`settings-tab-${section.id}`} type="button" role="tab" aria-selected={activeSection === section.id} className={activeSection === section.id ? 'settings-tab active' : 'settings-tab'} onClick={() => select(section.id)}><strong>{section.label}</strong><small>{section.hint}</small></button>)}</div></nav>
    {feedback ? <div className="settings-feedback" role="status">{feedback}</div> : null}
    <div className="settings-pane" hidden={activeSection !== 'jobs'}><JobsPage ref={jobsRef} embedded onDirtyChange={value => markDirty('jobs', value)} /></div>
    <div className="settings-pane" hidden={activeSection !== 'keywords'}><KeywordsPage ref={keywordsRef} embedded onDirtyChange={value => markDirty('keywords', value)} /></div>
    <div className="settings-pane" hidden={activeSection !== 'runtime'}><RuntimeSettingsSection ref={runtimeRef} onDirtyChange={value => markDirty('runtime', value)} /></div>
    <div className="settings-pane" hidden={activeSection !== 'ai'}><AIConfigPage ref={aiRef} embedded onDirtyChange={value => markDirty('ai', value)} /></div>
    <div className="settings-pane" hidden={activeSection !== 'data'}><DataBackupSection /></div>
  </div>;
}
