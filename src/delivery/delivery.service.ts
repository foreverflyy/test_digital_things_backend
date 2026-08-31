import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import { LedgerService } from '../ledger/ledger.service';
import { LoggerService } from '../logging/logger.service';
import { Order } from '../orders/order.entity';
import { OrdersService } from '../orders/orders.service';
import { QueueService } from '../queue/queue.service';
import { JOB_NAMES, Job } from '../queue/queue.types';
import { DeliveryAttempt, DeliveryAttemptsRepository } from './delivery-attempts.repository';
import { SUPPLIERS, SupplierClient, SupplierOutcome } from './suppliers/supplier.client';

const UNIQUE_VIOLATION = '23505';

export type DeliveryOutcome =
  | 'delivered'
  | 'already_delivered'
  | 'not_claimable'
  | 'unknown_order'
  | 'awaiting_reconcile'
  | 'out_of_stock'
  | 'delivery_failed';

@Injectable()
export class DeliveryService implements OnModuleInit {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(SUPPLIERS) private readonly suppliers: SupplierClient[],
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
    private readonly attempts: DeliveryAttemptsRepository,
    private readonly ledger: LedgerService,
    private readonly queue: QueueService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit(): void {
    this.queue.register(JOB_NAMES.deliverOrder, (job: Job) =>
      this.deliver(String(job.payload.orderId), Boolean(job.payload.force)).then(() => undefined),
    );
  }

  supplierById(id: string): SupplierClient | undefined {
    return this.suppliers.find((supplier) => supplier.id === id);
  }

  async deliver(orderId: string, force = false): Promise<DeliveryOutcome> {
    const outcome = await this.db.withAdvisoryLock(`deliver:${orderId}`, () =>
      this.deliverExclusively(orderId, force),
    );
    return outcome ?? 'not_claimable';
  }

  private async deliverExclusively(orderId: string, force: boolean): Promise<DeliveryOutcome> {
    const existing = await this.orders.findByIdOrNull(orderId);
    if (!existing) return 'unknown_order';
    if (existing.delivered_code) return 'already_delivered';

    const stuckAfterMs = force ? 0 : this.config.STUCK_ORDER_AGE_MS;
    const order = await this.orders.beginDelivering(orderId, stuckAfterMs);
    if (!order) return 'not_claimable';

    const reconciled = await this.reconcileOpenAttempts(order);
    if (reconciled === 'delivered') return 'delivered';
    if (reconciled === 'pending') return 'awaiting_reconcile';

    const failures: SupplierOutcome[] = [];

    for (const supplier of this.suppliers) {
      const attemptNo = await this.orders.nextAttemptNo(order.id);
      const requestId = `req_${order.id}_${supplier.id}_${attemptNo}`;
      const attempt = await this.attempts.open(order.id, supplier.id, requestId, attemptNo);

      const outcome = await supplier.issue({
        requestId,
        sku: order.sku,
        orderId: order.id,
      });

      if (outcome.kind === 'ok') {
        const finalized = await this.finalize(order, attempt, outcome.code, outcome.httpStatus);
        if (finalized) return 'delivered';
        failures.push({ kind: 'error', httpStatus: null, reason: 'code_conflict' });
        continue;
      }

      if (outcome.kind === 'timeout') {
        await this.attempts.markUnknown(attempt.id, 'timeout');
        this.logger.warn('delivery.timeout_unknown', {
          order_id: order.id,
          provider: supplier.id,
          request_id: requestId,
          outcome: 'unknown',
          note: 'no_fallback_until_reconciled',
        });
        return 'awaiting_reconcile';
      }

      const reason = outcome.kind === 'error' ? outcome.reason : outcome.kind;
      const httpStatus = 'httpStatus' in outcome ? outcome.httpStatus : null;
      await this.attempts.markFailed(attempt.id, reason, httpStatus);
      failures.push(outcome);
      this.logger.warn('delivery.provider_rejected', {
        order_id: order.id,
        provider: supplier.id,
        request_id: requestId,
        reason,
        http_status: httpStatus,
      });
    }

    const allOutOfStock =
      failures.length > 0 && failures.every((outcome) => outcome.kind === 'out_of_stock');
    const status = allOutOfStock ? 'out_of_stock' : 'delivery_failed';
    await this.orders.failDelivery(order.id, status);
    this.logger.warn('delivery.exhausted', {
      order_id: order.id,
      status_to: status,
      providers_tried: failures.length,
    });
    return status;
  }

  private async reconcileOpenAttempts(order: Order): Promise<'delivered' | 'pending' | 'clear'> {
    const open = await this.attempts.openAttemptsFor(order.id);
    if (open.length === 0) return 'clear';

    for (const attempt of open) {
      const supplier = this.supplierById(attempt.provider);
      if (!supplier) {
        await this.attempts.markFailed(attempt.id, 'unknown_provider', null);
        continue;
      }

      const outcome = await supplier.issue({
        requestId: attempt.request_id,
        sku: order.sku,
        orderId: order.id,
      });

      this.logger.info('delivery.reconcile', {
        order_id: order.id,
        provider: attempt.provider,
        request_id: attempt.request_id,
        reconcile_count: attempt.reconcile_count + 1,
        outcome: outcome.kind,
      });

      if (outcome.kind === 'ok') {
        const finalized = await this.finalize(order, attempt, outcome.code, outcome.httpStatus);
        if (finalized) return 'delivered';
        continue;
      }

      if (outcome.kind === 'timeout' || (outcome.kind === 'error' && outcome.httpStatus === null)) {
        const count = await this.attempts.bumpReconcile(attempt.id);
        await this.attempts.markUnknown(attempt.id, 'timeout');
        if (count < this.config.DELIVERY_MAX_RECONCILE) return 'pending';
        await this.attempts.markFailed(attempt.id, 'reconcile_exhausted', null);
        this.logger.error('delivery.manual_review_required', {
          order_id: order.id,
          provider: attempt.provider,
          request_id: attempt.request_id,
          reconcile_count: count,
        });
        continue;
      }

      const reason = outcome.kind === 'error' ? outcome.reason : outcome.kind;
      await this.attempts.markFailed(
        attempt.id,
        reason,
        'httpStatus' in outcome ? outcome.httpStatus : null,
      );
    }

    return 'clear';
  }

  private async finalize(
    order: Order,
    attempt: DeliveryAttempt,
    code: string,
    httpStatus: number,
  ): Promise<boolean> {
    try {
      return await this.commitDelivery(order, attempt, code, httpStatus);
    } catch (error) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      await this.attempts.markFailed(attempt.id, 'code_already_used', httpStatus);
      this.logger.error('delivery.code_conflict', {
        order_id: order.id,
        provider: attempt.provider,
        request_id: attempt.request_id,
        code,
      });
      return false;
    }
  }

  private async commitDelivery(
    order: Order,
    attempt: DeliveryAttempt,
    code: string,
    httpStatus: number,
  ): Promise<boolean> {
    return this.db.transaction(async () => {
      const claimed = await this.attempts.markOk(attempt.id, code, httpStatus);
      if (!claimed) return false;

      const delivered = await this.orders.completeDelivery(order.id, code, attempt.id);
      if (!delivered) {
        this.logger.error('delivery.finalize_conflict', {
          order_id: order.id,
          request_id: attempt.request_id,
          code,
        });
        return false;
      }

      await this.ledger.post('delivery_issued', {
        orderId: order.id,
        amountMinor: order.price_minor,
        currency: order.currency_code,
        ref: attempt.request_id,
      });

      this.logger.info('delivery.delivered', {
        order_id: order.id,
        provider: attempt.provider,
        request_id: attempt.request_id,
        attempt_no: attempt.attempt_no,
        status_from: 'delivering',
        status_to: 'delivered',
        code,
      });
      return true;
    });
  }

  async syncSupplierStock(): Promise<void> {
    for (const supplier of this.suppliers) {
      const stock = await supplier.stock();
      for (const item of stock) {
        await this.db.execute(
          `INSERT INTO supplier_stock (provider, sku, available, synced_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (provider, sku) DO UPDATE
             SET available = EXCLUDED.available, synced_at = now()`,
          [supplier.id, item.sku, item.available],
        );
      }
    }

    await this.db.execute(
      `UPDATE products p
       SET stock_count = COALESCE(s.total, 0), stock_synced_at = now()
       FROM (SELECT sku, SUM(available)::int AS total FROM supplier_stock GROUP BY sku) s
       WHERE p.sku = s.sku AND p.stock_count IS DISTINCT FROM COALESCE(s.total, 0)`,
    );
  }
}
