import type { ResultEntry, RunPhase, RunStatus } from '../../shared/contracts.js';

export class RunState {
  private phase: RunPhase = 'idle';
  private message = '就绪';
  private running = false;
  private results: ResultEntry[] = [];

  get isRunning(): boolean { return this.running; }
  get currentPhase(): RunPhase { return this.phase; }
  get allResults(): ResultEntry[] { return this.results; }

  begin(message: string): void {
    this.running = true;
    this.phase = 'navigating';
    this.message = message;
    this.results = [];
  }

  update(phase: RunPhase, message: string): void {
    this.phase = phase;
    this.message = message;
  }

  add(result: ResultEntry): void {
    this.results.push(result);
  }

  stop(): void {
    this.running = false;
    this.update('stopped', '用户停止');
  }

  complete(message: string): void {
    this.running = false;
    this.update('done', message);
  }

  fail(message: string): void {
    this.running = false;
    this.update('error', message);
  }

  markGreeted(candidate: { name: string; index: number }): void {
    for (const result of this.results) {
      if (result.name === candidate.name && result.index === candidate.index && result.status !== 'greeted') {
        result.status = 'greeted';
        result.stage = 'manual_greet';
      }
    }
  }

  status(): RunStatus {
    return {
      isRunning: this.running,
      phase: this.phase,
      message: this.message,
      results: this.results.length,
    };
  }
}
