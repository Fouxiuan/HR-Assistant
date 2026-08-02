import { createWriteStream, mkdirSync } from 'fs';
import { resolve } from 'path';
import config from './config.js';
import type { LoggerPort } from './core/ports.js';

class Logger implements LoggerPort {
  private logs: string[] = [];
  private listeners: Array<(line: string) => void> = [];
  private logFile: string;
  private fileStream: ReturnType<typeof createWriteStream>;

  constructor() {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    mkdirSync(config.paths.logs, { recursive: true });
    this.logFile = resolve(config.paths.logs, `session_${dateStr}.log`);
    this.fileStream = createWriteStream(this.logFile, { flags: 'a' });
    this.fileStream.on('error', error => console.error(`日志文件写入失败: ${error.message}`));
  }

  private _timestamp(): string {
    return new Date().toLocaleTimeString('zh-CN');
  }

  private _emit(level: string, message: string): void {
    const line = `[${this._timestamp()}] [${level}] ${message}`;
    this.logs.push(line);
    this.fileStream.write(line + '\n');
    this.listeners.forEach(fn => fn(line));
  }

  info(message: string): void {
    this._emit('INFO', message);
  }

  step(message: string): void {
    this._emit('STEP', message);
  }

  action(message: string): void {
    this._emit('ACTION', message);
  }

  success(message: string): void {
    this._emit('SUCCESS', message);
  }

  warn(message: string): void {
    this._emit('WARN', message);
  }

  error(message: string): void {
    this._emit('ERROR', message);
  }

  onLog(fn: (line: string) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(listener => listener !== fn);
    };
  }

  getLogs(limit = 100): string[] {
    return this.logs.slice(-limit);
  }
}

export default Logger;
