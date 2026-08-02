import type { JobDescription, JobDescriptionInput } from '../../shared/contracts.js';

export interface JobDescriptionRepository {
  readonly available: boolean;
  readonly unavailableReason?: string;
  list(): Promise<JobDescription[]>;
  upsert(input: JobDescriptionInput): Promise<JobDescription>;
  update(id: number, input: JobDescriptionInput): Promise<JobDescription | null>;
}

export class NoopJobDescriptionRepository implements JobDescriptionRepository {
  readonly available = false;

  constructor(readonly unavailableReason = '本地 JD 数据库不可用') {}

  async list(): Promise<JobDescription[]> { return []; }
  async upsert(): Promise<JobDescription> { throw new Error(this.unavailableReason); }
  async update(): Promise<null> { throw new Error(this.unavailableReason); }
}
