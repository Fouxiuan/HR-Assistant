import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import type { Settings } from '@shared/contracts';
import { post } from '../../api/client';
import { useFetch } from '../../api/useFetch';
import { LoadingState } from '../../components/States';
import type { SettingsSectionHandle } from './section';
import type { SettingsSectionProps } from './section';

const filterDefinitions: Array<{ key: string; label: string; single?: boolean; options: string[] }> = [
  { key: 'activity', label: '活跃度', single: true, options: ['不限', '刚刚活跃', '今日活跃', '3日内活跃', '本周活跃', '本月活跃'] },
  { key: 'gender', label: '性别', options: ['不限', '男', '女'] },
  { key: 'keywords', label: '牛人关键词', options: ['小红书运营', '抖音运营', '短视频运营', '社群运营', '数据分析', '视频剪辑', '文案功底', '拍摄', '主播'] },
  { key: 'recentViewed', label: '近期没有看过', options: ['不限', '近14天没有'] },
  { key: 'resumeExchange', label: '简历交换', options: ['不限', '近一个月没有'] },
  { key: 'schools', label: '院校', options: ['不限', '985', '211', '双一流院校', '留学', '国内外名校', '公办本科'] },
  { key: 'majors', label: '专业', options: ['不限', '新闻传播学类', '电子商务类', '工商管理类', '管理科学与工程类', '经济与贸易类'] },
  { key: 'jobChangeFrequency', label: '跳槽频率', single: true, options: ['不限', '5年少于3份', '平均每份工作大于1年'] },
  { key: 'jobIntent', label: '求职意向', options: ['不限', '离职-随时到岗', '在职-暂不考虑', '在职-考虑机会', '在职-月内到岗'] },
  { key: 'educationRequirements', label: '学历要求', options: ['不限', '初中及以下', '中专/中技', '高中', '大专', '本科', '硕士', '博士'] },
  { key: 'experienceRequirements', label: '经验要求', options: ['不限', '在校/应届', '25年毕业', '26年毕业', '26年后毕业', '1年以内', '1-3年', '3-5年', '5-10年', '10年以上'] },
  { key: 'salary', label: '薪资待遇', single: true, options: ['不限', '3K以下', '3-5K', '5-10K', '10-20K', '20-50K', '50K以上'] },
];

const basicNumberFields: Array<{ key: keyof Settings; label: string; min: number; max: number; step?: number }> = [
  { key: 'minScore', label: '最低 AI 分数', min: 0, max: 100 },
  { key: 'totalGreetTarget', label: '总招呼目标', min: 1, max: 200 },
  { key: 'actionDelayMs', label: '操作间隔（ms）', min: 500, max: 30000, step: 500 },
  { key: 'maxEmptyScrolls', label: '最大空滚次数', min: 1, max: 20 },
];

const intervalFields: Array<{ key: keyof Settings; label: string; min: number; max: number; step?: number }> = [
  { key: 'scanIntervalSec', label: '扫描间隔（秒）', min: 0.5, max: 30, step: 0.5 },
  { key: 'evaluateIntervalSec', label: '评估间隔（秒）', min: 0.5, max: 30, step: 0.5 },
  { key: 'greetIntervalSec', label: '招呼间隔（秒）', min: 0.5, max: 30, step: 0.5 },
  { key: 'closeDetailIntervalSec', label: '关详情间隔（秒）', min: 0.5, max: 30, step: 0.5 },
];

export const RuntimeSettingsSection = forwardRef<SettingsSectionHandle, SettingsSectionProps>(function RuntimeSettingsSection({ onDirtyChange }, ref) {
  const { data, mutate } = useFetch<Settings>('/api/settings');
  const [draft, setDraft] = useState<Settings | null>(null);

  useEffect(() => { if (data) setDraft(data); }, [data]);
  useEffect(() => { onDirtyChange?.(Boolean(data && draft && JSON.stringify(data) !== JSON.stringify(draft))); }, [data, draft, onDirtyChange]);

  const save = useCallback(async () => {
    if (!draft) throw new Error('运行参数尚未读取完成');
    await post('/api/settings', draft);
    await mutate();
  }, [draft, mutate]);

  useImperativeHandle(ref, () => ({ save }), [save]);

  if (!draft) return <LoadingState label="正在读取运行参数…" />;

  const updateFilter = (key: string, option: string, single = false) => {
    const filters = { ...draft.bossFilters };
    const selected = Array.isArray(filters[key]) ? filters[key] as string[] : [];
    let next: string[];
    if (single) next = [option];
    else if (option === '不限') next = ['不限'];
    else {
      const withoutAny = selected.filter((item) => item !== '不限');
      next = withoutAny.includes(option) ? withoutAny.filter((item) => item !== option) : [...withoutAny, option];
      if (next.length === 0) next = ['不限'];
    }
    (filters as Record<string, unknown>)[key] = next;
    setDraft({ ...draft, bossFilters: filters });
  };

  return (
    <>
      <section className="card form-card">
        <h2>页面筛选</h2>
        <label>工作城市
          <input name="boss-location" autoComplete="off" value={draft.bossFilters.location || ''} onChange={(event) => setDraft({ ...draft, bossFilters: { ...draft.bossFilters, location: event.target.value } })} placeholder="例如：广州…" />
        </label>
        <div className="filter-stack">
          {filterDefinitions.map((definition) => {
            const selected = (draft.bossFilters[definition.key] as string[] | undefined) || ['不限'];
            return (
              <fieldset key={definition.key}>
                <legend>{definition.label}{definition.single ? ' · 单选' : ''}</legend>
                <div className="choice-row">
                  {definition.options.map((option) => (
                    <button type="button" className={selected.includes(option) ? 'choice active' : 'choice'} aria-pressed={selected.includes(option)} key={option} onClick={() => updateFilter(definition.key, option, definition.single)}>{option}</button>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </section>
      <section className="card form-card">
        <h2>候选人筛选</h2>
        <div className="field-grid three">
          <label>年龄下限<input name="candidate-age-min" autoComplete="off" type="number" min={16} max={60} value={draft.candidateAgeMin ?? 23} onChange={(event) => setDraft({ ...draft, candidateAgeMin: Number(event.target.value) })} /></label>
          <label>年龄上限<input name="candidate-age-max" autoComplete="off" type="number" min={16} max={60} value={draft.candidateAgeMax ?? 30} onChange={(event) => setDraft({ ...draft, candidateAgeMax: Number(event.target.value) })} /></label>
        </div>
      </section>
      <section className="card form-card">
        <h2>批次控制</h2>
        <div className="field-grid three">
          {basicNumberFields.map((field) => (
            <label key={field.key}>{field.label}<input name={String(field.key)} autoComplete="off" type="number" min={field.min} max={field.max} step={field.step} value={draft[field.key] as number} onChange={(event) => setDraft({ ...draft, [field.key]: Number(event.target.value) })} /></label>
          ))}
        </div>
      </section>
      <section className="card form-card">
        <h2>分阶段间隔</h2>
        <div className="field-grid three">
          {intervalFields.map((field) => (
            <label key={field.key}>{field.label}<input name={String(field.key)} autoComplete="off" type="number" min={field.min} max={field.max} step={field.step} value={draft[field.key] as number} onChange={(event) => setDraft({ ...draft, [field.key]: Number(event.target.value) })} /></label>
          ))}
        </div>
      </section>
    </>
  );
});
