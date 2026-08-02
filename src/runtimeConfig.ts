import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Settings } from '../shared/contracts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = process.env.APP_CONFIG_DIR ? resolve(process.env.APP_CONFIG_DIR) : resolve(__dirname, '..', 'config');
const configFile = resolve(configDir, 'settings.json');

const defaults: Settings = {
  selectedJob: '',
  bossJobTitle: '',
  bossFilters: {
    location: '',
    ageMin: '',
    ageMax: '',
    activity: ['不限'],
    gender: ['不限'],
    keywords: [],
    recentViewed: ['不限'],
    resumeExchange: ['不限'],
    schools: ['不限'],
    majors: ['不限'],
    jobChangeFrequency: ['不限'],
    jobIntent: ['不限'],
    educationRequirements: ['不限'],
    experienceRequirements: ['不限'],
    salary: ['不限'],
  },
  candidateAgeMin: 23,
  candidateAgeMax: 30,
  minScore: 95,
  totalGreetTarget: 20,
  maxEmptyScrolls: 3,
  actionDelayMs: 3000,
  maxCandidates: 50,
  scanIntervalSec: 3,
  evaluateIntervalSec: 3,
  greetIntervalSec: 2,
  closeDetailIntervalSec: 1.5,
};

let cached: Settings | null = null;

function load(): Settings {
  if (cached) return cached;
  try {
    const raw = readFileSync(configFile, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    cached = {
      ...defaults,
      ...parsed,
      bossFilters: { ...defaults.bossFilters, ...parsed.bossFilters },
    };
  } catch {
    cached = { ...defaults };
    save(cached);
  }
  return cached;
}

function save(data: Settings): void {
  const dir = dirname(configFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configFile, JSON.stringify(data, null, 2), 'utf-8');
  cached = data;
}

function get(): Settings {
  return load();
}

function update(partial: Partial<Settings>): Settings {
  const current = load();
  const data = {
    ...current,
    ...partial,
    bossFilters: partial.bossFilters
      ? { ...current.bossFilters, ...partial.bossFilters }
      : current.bossFilters,
  };
  save(data);
  return data;
}

function getFilePath(): string { return configFile; }
function resetCache(): void { cached = null; }

export default { get, update, defaults, getFilePath, resetCache };
