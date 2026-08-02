import { describe, expect, it } from 'vitest';
import { RunState } from '../src/core/runState.js';

describe('RunState', () => {
  it('uses an explicit stopped terminal state', () => {
    const state = new RunState();
    state.begin('启动中');
    state.stop();
    expect(state.status()).toMatchObject({ isRunning: false, phase: 'stopped', message: '用户停止' });
  });

  it('resets results when a new run begins', () => {
    const state = new RunState();
    state.begin('第一次');
    state.add({
      index: 0, name: '候选人', salary: '', age: '', years: '', education: '', expected: '', advantage: '',
      tags: [], fullText: '', status: 'rejected', stage: 'age', timestamp: new Date().toISOString(),
    });
    state.begin('第二次');
    expect(state.status().results).toBe(0);
  });
});
