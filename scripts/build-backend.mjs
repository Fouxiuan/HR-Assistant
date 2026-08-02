import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const outputDir = resolve('dist-backend');
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: resolve(outputDir, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

cpSync(
  resolve('node_modules', 'pdf-parse', 'dist', 'worker', 'pdf.worker.mjs'),
  resolve(outputDir, 'pdf.worker.mjs'),
);
