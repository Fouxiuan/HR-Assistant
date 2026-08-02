import express, { type Express } from 'express';
import fs from 'fs';
import { resolve } from 'path';
import config from '../config.js';
import type { RouteContext } from './context.js';
import { registerRoutes } from './routes.js';

interface AppOptions {
  serveUi?: boolean;
}

export function createApp(context: RouteContext, options: AppOptions = {}): Express {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  registerRoutes(app, context);

  if (options.serveUi !== false) {
    const webDist = resolve(config.rootDir, 'web', 'dist');
    if (fs.existsSync(webDist)) {
      app.use(express.static(webDist));
      app.get('*', (_request, response) => response.sendFile(resolve(webDist, 'index.html')));
    } else {
      app.get('*', (_request, response) => response.status(503).send('前端尚未构建，请先执行 npm run build:web'));
    }
  }

  return app;
}
