import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const source = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

describe('standalone network boundary', () => {
  it('binds the backend only to the loopback interface', () => {
    expect(source('src', 'server', 'index.ts')).toContain("app.listen(config.server.port, '127.0.0.1'");
    expect(source('electron', 'app.js')).toContain('host = "127.0.0.1"');
  });

  it('does not enable open CORS or register removed center routes', () => {
    expect(source('src', 'server', 'app.ts')).not.toMatch(/\bcors\s*\(/);
    const routes = source('src', 'server', 'routes.ts');
    expect(routes).not.toMatch(/account|ingest|upload/i);
  });

  it('contains no center URL configuration or remote repository implementation', () => {
    const files = [source('src', 'aiConfig.ts'), source('src', 'server', 'context.ts'), source('src', 'db', 'pool.ts'), source('electron', 'app.js')].join('\n');
    expect(files).not.toMatch(/DEFAULT_SERVER_URL|DATABASE_URL|server\.json|RemoteCandidateRepository/);
  });
});
