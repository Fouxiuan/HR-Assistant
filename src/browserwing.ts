import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import config from './config.js';
import type { BrowserPort, LoggerPort } from './core/ports.js';

type ToolArguments = Record<string, unknown>;

class BrowserWingClient implements BrowserPort {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private connected = false;

  constructor(private readonly logger: LoggerPort) {
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      const mcpUrl = `http://127.0.0.1:${config.browserwing.port}${config.browserwing.mcpPath}`;
      this.transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
      this.client = new Client(
        { name: 'boss-auto-greet-v2', version: '2.0.0' },
        { capabilities: {} }
      );
      await this.client.connect(this.transport);
      this.connected = true;
      this.logger.info('BrowserWing 连接成功');
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      this.logger.error(`BrowserWing 连接失败: ${err.message}`);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      try { await this.transport.close(); } catch {}
      this.connected = false;
      this.logger.info('BrowserWing 断开连接');
    }
  }

  async callTool(name: string, args: ToolArguments = {}): Promise<unknown> {
    await this.connect();
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (!this.client) throw new Error('BrowserWing client is not connected');
        const result = await this.client.callTool({ name, arguments: args });
        const content: unknown = result.content;
        if (Array.isArray(content)) {
          const first: unknown = content[0];
          if (first !== null && typeof first === 'object' && 'type' in first && 'text' in first
            && first.type === 'text' && typeof first.text === 'string') {
            return first.text;
          }
        }
        return result;
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        // Server restarted / session expired → force full re-connect with new session, then retry once
        if (err.message.includes('Invalid session ID') && attempt === 1) {
          this.logger.warn(`${name} 会话失效，重建连接后重试`);
          await this.resetConnection();
          continue;
        }
        this.logger.error(`调用 ${name} 失败: ${err.message}`);
        throw err;
      }
    }
    throw new Error('unreachable');
  }

  private async resetConnection(): Promise<void> {
    if (this.transport) {
      try { await this.transport.close(); } catch {}
    }
    this.client = null;
    this.transport = null;
    this.connected = false;
    await this.connect();
  }

  async navigate(url: string): Promise<unknown> {
    return this.callTool('browser_navigate', { url });
  }

  async snapshot(): Promise<unknown> {
    return this.callTool('browser_snapshot');
  }

  async click(identifier: string): Promise<unknown> {
    return this.callTool('browser_click', { identifier });
  }

  async type(identifier: string, text: string): Promise<unknown> {
    return this.callTool('browser_type', { identifier, text });
  }

  async scroll(direction = 'down'): Promise<unknown> {
    return this.callTool('browser_scroll', { direction });
  }

  async press(key: string): Promise<unknown> {
    return this.callTool('browser_press_key', { key });
  }

  async eval(script: string): Promise<unknown> {
    // BrowserWing's browser_evaluate expects { script } not { expression }
    const raw = await this.callTool('browser_evaluate', { script });
    // Parse "Successfully executed script\nResult: <value>" format
    if (typeof raw === 'string') {
      const match = raw.match(/Result:\s*(.*)/);
      if (match) {
        const val = match[1].trim();
        if (val === '<nil>') return null;
        // Try parsing as JSON
        try { return JSON.parse(val); } catch {}
        return val;
      }
    }
    return raw;
  }

  async screenshot(): Promise<unknown> {
    return this.callTool('browser_take_screenshot');
  }

  async extract(selector: string, attribute: string): Promise<unknown> {
    return this.callTool('browser_extract', { selector, attribute });
  }

  // ── cookie persistence ────────────────────

  async getCookies(): Promise<string> {
    try {
      const cookies = await this.eval('() => document.cookie');
      return typeof cookies === 'string' ? cookies : String(cookies ?? '');
    } catch {
      this.logger.warn('读取 document.cookie 失败');
      return '';
    }
  }

  async injectCookies(cookieString: string): Promise<void> {
    if (!cookieString) return;
    try {
      await this.navigate('https://www.zhipin.com');
      // Set cookies one by one via document.cookie
      const parts = cookieString.split(';').map(c => c.trim()).filter(Boolean);
      for (const part of parts) {
        await this.eval(`() => { document.cookie = ${JSON.stringify(part + '; path=/; domain=.zhipin.com')}; }`);
      }
      this.logger.info(`已注入 ${parts.length} 个 cookie`);
    } catch (err) {
      this.logger.warn(`Cookie 注入失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export default BrowserWingClient;
