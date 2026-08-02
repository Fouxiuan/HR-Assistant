import type { Express, Request, Response } from 'express';
import type { Settings } from '../../../shared/contracts.js';
import type { RouteContext } from '../context.js';

const filterArrayKeys = new Set([
  'activity', 'gender', 'keywords', 'recentViewed', 'resumeExchange', 'schools', 'majors',
  'jobChangeFrequency', 'jobIntent', 'educationRequirements', 'experienceRequirements', 'salary',
]);
const filterScalarKeys = new Set(['location', 'ageMin', 'ageMax']);

const numericRanges: Record<string, [number, number]> = {
  minScore: [0, 100],
  totalGreetTarget: [1, 200],
  maxEmptyScrolls: [1, 20],
  actionDelayMs: [500, 30000],
  maxCandidates: [1, 1000],
  candidateAgeMin: [16, 60],
  candidateAgeMax: [16, 60],
  scanIntervalSec: [0.5, 30],
  evaluateIntervalSec: [0.5, 30],
  greetIntervalSec: [0.5, 30],
  closeDetailIntervalSec: [0.5, 30],
};

function sanitizeSettings(body: unknown, current: Settings): Partial<Settings> {
  if (!body || typeof body !== 'object') return {};
  const input = body as Record<string, unknown>;
  const output: Partial<Settings> = {};

  if (typeof input.selectedJob === 'string') output.selectedJob = input.selectedJob.trim().slice(0, 200);
  if (typeof input.bossJobTitle === 'string') output.bossJobTitle = input.bossJobTitle.trim().slice(0, 200);
  if (input.bossFilters && typeof input.bossFilters === 'object' && !Array.isArray(input.bossFilters)) {
    const filters: Settings['bossFilters'] = {};
    for (const [key, value] of Object.entries(input.bossFilters as Record<string, unknown>)) {
      if (filterArrayKeys.has(key) && Array.isArray(value)) {
        filters[key] = value.filter((item): item is string => typeof item === 'string').map(item => item.trim().slice(0, 200)).slice(0, 100);
      } else if (filterScalarKeys.has(key) && (typeof value === 'string' || typeof value === 'number')) {
        filters[key] = typeof value === 'string' ? value.trim().slice(0, 200) : value;
      }
    }
    output.bossFilters = filters;
  }
  for (const [key, [minimum, maximum]] of Object.entries(numericRanges)) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      (output as Record<string, unknown>)[key] = Math.min(maximum, Math.max(minimum, value));
    }
  }
  const minimumAge = output.candidateAgeMin ?? current.candidateAgeMin;
  const maximumAge = output.candidateAgeMax ?? current.candidateAgeMax;
  if (minimumAge > maximumAge) throw new Error('候选人最小年龄不能大于最大年龄');
  return output;
}

export function registerSettingsRoutes(app: Express, context: RouteContext): void {
  app.get('/api/settings', (_request: Request, response: Response) => {
    response.json(context.settings.get());
  });

  app.post('/api/settings', (request: Request, response: Response) => {
    try {
      const updated = context.settings.update(sanitizeSettings(request.body, context.settings.get()));
      context.logger.info('运行设置已更新');
      response.json({ success: true, data: updated });
    } catch (error) {
      response.status(400).json({ success: false, message: error instanceof Error ? error.message : String(error) });
    }
  });
}
