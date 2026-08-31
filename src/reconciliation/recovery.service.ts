import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import { DeliveryAttemptsRepository } from '../delivery/delivery-attempts.repository';
import { DeliveryService } from '../delivery/delivery.service';
import { LoggerService } from '../logging/logger.service';
import { PAID_NOT_DELIVERED_STATUSES } from '../orders/order-status';
import { PaymentsService } from '../payments/payments.service';
import { QueueService } from '../queue/queue.service';
import { QueueWorker } from '../queue/queue.worker';
import { JOB_NAMES } from '../queue/queue.types';

export interface RecoverySummary {
  orphan_events_applied: number;
  stuck_orders_resumed: number;
  unknown_attempts_reconciled: number;
}

@Injectable()
export class RecoveryService implements OnModuleInit {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DatabaseService,
    private readonly payments: PaymentsService,
    private readonly delivery: DeliveryService,
    private readonly attempts: DeliveryAttemptsRepository,
    private readonly queue: QueueService,
    private readonly worker: QueueWorker,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit(): void {
    this.queue.register(JOB_NAMES.resumeStuckOrders, () => this.resumeStuckOrders().then(() => undefined));
    this.queue.register(JOB_NAMES.reconcileUnknownAttempts, () =>
      this.reconcileUnknownAttempts().then(() => undefined),
    );
    this.queue.register(JOB_NAMES.syncSupplierStock, () => this.delivery.syncSupplierStock());
  }

  async resumeStuckOrders(force = false): Promise<number> {
    const baseSeconds = (force ? 0 : this.config.STUCK_ORDER_AGE_MS) / 1000;
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM orders
       WHERE status = ANY($1::text[])
         AND ($4::boolean OR delivery_attempt_no < $3)
         AND updated_at < now() - make_interval(
               secs => $2 * LEAST(32, GREATEST(1, POWER(2, GREATEST(0, delivery_attempt_no - 2))))
             )
       ORDER BY updated_at
       LIMIT 200`,
      [PAID_NOT_DELIVERED_STATUSES, baseSeconds, this.config.DELIVERY_MAX_ATTEMPTS, force],
    );

    for (const row of rows) {
      if (force) {
        await this.delivery.deliver(row.id, true);
      } else {
        await this.queue.enqueue(
          JOB_NAMES.deliverOrder,
          { orderId: row.id, force: true },
          { dedupeKey: `deliver:${row.id}` },
        );
      }
    }

    if (rows.length > 0) this.logger.info('recovery.stuck_orders', { count: rows.length, force });
    return rows.length;
  }

  async reconcileUnknownAttempts(force = false): Promise<number> {
    const orderIds = await this.attempts.ordersWithOpenAttempts(
      force ? 0 : this.config.STUCK_ORDER_AGE_MS,
    );

    for (const orderId of orderIds) {
      if (force) {
        await this.delivery.deliver(orderId, true);
      } else {
        await this.queue.enqueue(
          JOB_NAMES.deliverOrder,
          { orderId, force: true },
          { dedupeKey: `deliver:${orderId}` },
        );
      }
    }

    if (orderIds.length > 0) {
      this.logger.info('recovery.unknown_attempts', { count: orderIds.length, force });
    }
    return orderIds.length;
  }

  async runAll(): Promise<RecoverySummary> {
    await this.worker.drain();
    await this.delivery.syncSupplierStock();
    const orphans = await this.payments.sweepOrphanEvents();
    const unknown = await this.reconcileUnknownAttempts(true);
    const stuck = await this.resumeStuckOrders(true);
    await this.worker.drain();
    return {
      orphan_events_applied: orphans,
      stuck_orders_resumed: stuck,
      unknown_attempts_reconciled: unknown,
    };
  }
}
