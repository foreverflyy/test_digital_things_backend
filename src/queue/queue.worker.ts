import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfig, CONFIG } from '../config/app-config';
import { LoggerService } from '../logging/logger.service';
import { QueueService } from './queue.service';
import { JOB_NAMES, Job } from './queue.types';

@Injectable()
export class QueueWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly queue: QueueService,
    private readonly logger: LoggerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.registerSchedule(JOB_NAMES.applyOrphanEvents, 2000);
    await this.queue.registerSchedule(JOB_NAMES.reconcileUnknownAttempts, 3000);
    await this.queue.registerSchedule(JOB_NAMES.resumeStuckOrders, 3000);
    await this.queue.registerSchedule(JOB_NAMES.syncSupplierStock, 10000);

    if (!this.config.WORKER_ENABLED) return;
    this.timer = setInterval(() => void this.tick(), this.config.WORKER_POLL_INTERVAL_MS);
    this.logger.info('worker.started', { worker_id: this.workerId });
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;
    try {
      await this.queue.reclaimStale();
      await this.queue.dispatchDueSchedules();
      const jobs = await this.queue.claim(this.workerId, this.config.WORKER_CONCURRENCY);
      await Promise.all(jobs.map((job) => this.execute(job)));
      return jobs.length;
    } catch (error) {
      this.logger.error('worker.tick_failed', { error: String(error) });
      return 0;
    } finally {
      this.running = false;
    }
  }

  async drain(maxIterations = 200): Promise<void> {
    for (let i = 0; i < maxIterations; i += 1) {
      const processed = await this.tick();
      if (processed === 0 && (await this.queue.pendingCount()) === 0) return;
    }
  }

  private async execute(job: Job): Promise<void> {
    const handler = this.queue.handlerFor(job.name);
    if (!handler) {
      await this.queue.fail(job, `no handler for job ${job.name}`);
      return;
    }
    const traceId = job.trace_id ?? randomUUID();
    await LoggerService.runWithTrace(traceId, async () => {
      const startedAt = Date.now();
      try {
        await handler(job);
        await this.queue.complete(job.id);
        this.logger.debug('job.completed', {
          job_id: job.id,
          job_name: job.name,
          duration_ms: Date.now() - startedAt,
        });
      } catch (error) {
        await this.queue.fail(job, error);
      }
    });
  }
}
