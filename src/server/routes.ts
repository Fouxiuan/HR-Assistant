import type { Express } from 'express';
import type { RouteContext } from './context.js';
import { registerAIConfigRoutes } from './routes/aiConfigRoutes.js';
import { registerCandidateRoutes } from './routes/candidateRoutes.js';
import { registerMailRoutes } from './routes/mailRoutes.js';
import { registerJobDescriptionRoutes } from './routes/jobDescriptionRoutes.js';
import { registerJobsKeywordsRoutes } from './routes/jobsKeywordsRoutes.js';
import { registerLogsResultsRoutes } from './routes/logsResultsRoutes.js';
import { registerRunRoutes } from './routes/runRoutes.js';
import { registerSettingsRoutes } from './routes/settingsRoutes.js';
import { registerDataRoutes } from './routes/dataRoutes.js';

export function registerRoutes(app: Express, context: RouteContext): void {
  registerDataRoutes(app, context);
  registerAIConfigRoutes(app, context);
  registerJobDescriptionRoutes(app, context);
  registerJobsKeywordsRoutes(app, context);
  registerSettingsRoutes(app, context);
  registerRunRoutes(app, context);
  registerLogsResultsRoutes(app, context);
  registerCandidateRoutes(app, context);
  registerMailRoutes(app, context);
}
