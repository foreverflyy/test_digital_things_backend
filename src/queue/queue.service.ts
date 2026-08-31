import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { LoggerService } from '../logging/logger.service';
import { EnqueueOptions, Job, JobHandler } from './queue.types';

@Injectable()
export class QueueService {
  private readonly handlers = new Map<string, JobHandler>();

  constructor(
    private readonly db: DatabaseService,
    private readonly logger: LoggerService,
  ) {}

  register(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  handlerFor(name: string): JobHandler | undefined {
    return this.handlers.get(name);
  }

  async enqueue(
    name: string,
    payload: Record<string, unknown> = {},
    options: EnqueueOptions = {},
  ): Promise<number | null> {
    const row = await this.db.queryOne<{ id: number }>(
      `INSERT INTO jobs (name, dedupe_key, payload, run_at, max_attempts, trace_id)
       VALUES ($1, $2, $3::jsonb, now() + make_interval(secs => $4), $5, $6)
       ON CONFLICT (name, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending','running')
       DO NOTHING
       RETURNING id`,
      [
        name,
        options.dedupeKey ?? null,
        JSON.stringify(payload),
        (options.delayMs ?? 0) / 1000,
        options.maxAttempts ?? 25,
        LoggerService.currentTraceId() ?? null,
      ],
    );
    return row?.id ?? null;
  }

  async claim(workerId: string, limit: number): Promise<Job[]> {
    return this.db.query<Job>(
      `WITH claimed AS (
         SELECT id FROM jobs
         WHERE status = 'pending' AND run_at <= now()
         ORDER BY run_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE jobs j
       SET status = 'running', locked_at = now(), locked_by = $1,
           attempts = j.attempts + 1, updated_at = now()
       FROM claimed
       WHERE j.id = claimed.id
       RETURNING j.id, j.name, j.dedupe_key, j.payload, j.attempts, j.max_attempts, j.trace_id`,
      [workerId, limit],
    );
  }

  async complete(jobId: number): Promise<void> {
    await this.db.execute(
      `UPDATE jobs SET status = 'done', locked_at = NULL, locked_by = NULL, updated_at = now()
       WHERE id = $1`,
      [jobId],
    );
  }

  async fail(job: Job, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = job.attempts >= job.max_attempts;
    const backoffSeconds = Math.min(60, 0.25 * 2 ** Math.min(job.attempts, 8));
    await this.db.execute(
      `UPDATE jobs
       SET status = $2,
           run_at = now() + make_interval(secs => $3),
           locked_at = NULL, locked_by = NULL,
           last_error = $4, updated_at = now()
       WHERE id = $1`,
      [job.id, exhausted ? 'failed' : 'pending', backoffSeconds, message.slice(0, 1000)],
    );
    this.logger.warn('job.failed', {
      job_id: job.id,
      job_name: job.name,
      attempts: job.attempts,
      exhausted,
      error: message,
    });
  }

  async reclaimStale(olderThanSeconds = 60): Promise<number> {
    return this.db.execute(
      `UPDATE jobs SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now()
       WHERE status = 'running' AND locked_at < now() - make_interval(secs => $1)`,
      [olderThanSeconds],
    );
  }

  async registerSchedule(name: string, intervalMs: number): Promise<void> {
    await this.db.execute(
      `INSERT INTO schedules (name, interval_ms, next_run_at)
       VALUES ($1, $2, now())
       ON CONFLICT (name) DO UPDATE SET interval_ms = EXCLUDED.interval_ms`,
      [name, intervalMs],
    );
  }

  async dispatchDueSchedules(): Promise<string[]> {
    const due = await this.db.query<{ name: string }>(
      `UPDATE schedules
       SET next_run_at = now() + make_interval(secs => interval_ms / 1000.0), last_run_at = now()
       WHERE next_run_at <= now()
       RETURNING name`,
    );
    for (const row of due) {
      await this.enqueue(row.name, {}, { dedupeKey: row.name, maxAttempts: 3 });
    }
    return due.map((row) => row.name);
  }

  async pendingCount(): Promise<number> {
    const row = await this.db.queryOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM jobs WHERE status IN ('pending','running')`,
    );
    return row?.count ?? 0;
  }
}
