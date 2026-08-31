import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { LedgerService } from '../ledger/ledger.service';
import { LoggerService } from '../logging/logger.service';
import { MoneyService } from '../money/money.service';
import { OrdersService } from '../orders/orders.service';
import { QueueService } from '../queue/queue.service';
import { JOB_NAMES, Job } from '../queue/queue.types';
import { ApplyResult, PaymentWebhookPayload } from './payment-event.schema';

interface StoredEvent {
  event_id: string;
  order_id: string;
  status: 'paid' | 'failed';
  amount_minor: number;
  currency_code: string;
  occurred_at: Date;
}

@Injectable()
export class PaymentsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
    private readonly ledger: LedgerService,
    private readonly queue: QueueService,
    private readonly money: MoneyService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit(): void {
    this.queue.register(JOB_NAMES.applyOrphanEvents, (job) => this.handleOrphanJob(job));
  }

  async handleWebhook(payload: PaymentWebhookPayload): Promise<{ result: ApplyResult }> {
    if (!this.money.isKnown(payload.currency)) {
      throw new BadRequestException({ error: 'unknown_currency', currency: payload.currency });
    }

    const amountMinor = this.money.toMinor(payload.amount, payload.currency);
    const occurredAt = new Date(payload.created_at);

    const result = await this.db.transaction(async () => {
      const inserted = await this.db.queryOne<{ event_id: string }>(
        `INSERT INTO payment_events
           (event_id, order_id, status, amount_minor, currency_code, occurred_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [
          payload.event_id,
          payload.order_id,
          payload.status,
          amountMinor,
          payload.currency,
          occurredAt,
          JSON.stringify(payload),
        ],
      );

      if (!inserted) return 'duplicate' as ApplyResult;

      return this.apply({
        event_id: payload.event_id,
        order_id: payload.order_id,
        status: payload.status,
        amount_minor: amountMinor,
        currency_code: payload.currency,
        occurred_at: occurredAt,
      });
    });

    this.logger.info('payment.webhook_processed', {
      event_id: payload.event_id,
      order_id: payload.order_id,
      payment_status: payload.status,
      amount_minor: amountMinor,
      currency: payload.currency,
      result,
    });

    return { result };
  }

  private async apply(event: StoredEvent): Promise<ApplyResult> {
    const order = await this.orders.lockById(event.order_id);

    if (!order) {
      await this.markEvent(event.event_id, 'order_missing', false);
      return 'order_missing';
    }

    if (event.status === 'failed') {
      if (order.last_payment_event_at && event.occurred_at < order.last_payment_event_at) {
        await this.markEvent(event.event_id, 'ignored_stale', true);
        return 'ignored_stale';
      }

      const changed = await this.orders.markPaymentFailed(order.id, event.occurred_at);
      const result: ApplyResult = changed ? 'applied' : 'ignored_not_pending';
      if (!changed) await this.orders.touchPaymentEventAt(order.id, event.occurred_at);
      await this.markEvent(event.event_id, result, true);
      return result;
    }

    if (
      event.currency_code !== order.currency_code ||
      event.amount_minor !== order.price_minor
    ) {
      this.logger.error('payment.amount_mismatch', {
        event_id: event.event_id,
        order_id: order.id,
        expected_minor: order.price_minor,
        received_minor: event.amount_minor,
        expected_currency: order.currency_code,
        received_currency: event.currency_code,
      });
      await this.markEvent(event.event_id, 'amount_mismatch', true);
      return 'amount_mismatch';
    }

    const changed = await this.orders.markPaid(order.id, event.occurred_at);
    if (!changed) {
      await this.orders.touchPaymentEventAt(order.id, event.occurred_at);
      await this.markEvent(event.event_id, 'ignored_not_pending', true);
      return 'ignored_not_pending';
    }

    await this.ledger.post('payment_captured', {
      orderId: order.id,
      amountMinor: order.price_minor,
      currency: order.currency_code,
      ref: event.event_id,
    });

    await this.queue.enqueue(
      JOB_NAMES.deliverOrder,
      { orderId: order.id },
      { dedupeKey: `deliver:${order.id}` },
    );

    await this.markEvent(event.event_id, 'applied', true);
    this.logger.info('payment.captured', {
      event_id: event.event_id,
      order_id: order.id,
      status_from: 'created',
      status_to: 'paid',
      amount_minor: order.price_minor,
      currency: order.currency_code,
    });
    return 'applied';
  }

  private async markEvent(eventId: string, result: ApplyResult, applied: boolean): Promise<void> {
    await this.db.execute(
      `UPDATE payment_events
       SET apply_result = $2, applied_at = CASE WHEN $3 THEN now() ELSE NULL END
       WHERE event_id = $1`,
      [eventId, result, applied],
    );
  }

  async applyPendingForOrder(orderId: string): Promise<number> {
    const pending = await this.db.query<StoredEvent>(
      `SELECT event_id, order_id, status, amount_minor, currency_code, occurred_at
       FROM payment_events
       WHERE order_id = $1 AND applied_at IS NULL
       ORDER BY occurred_at, received_at`,
      [orderId],
    );

    let applied = 0;
    for (const event of pending) {
      const result = await this.db.transaction(() => this.apply(event));
      if (result !== 'order_missing') applied += 1;
    }
    return applied;
  }

  async sweepOrphanEvents(): Promise<number> {
    const orderIds = await this.db.query<{ order_id: string }>(
      `SELECT DISTINCT e.order_id
       FROM payment_events e
       JOIN orders o ON o.id = e.order_id
       WHERE e.applied_at IS NULL
       LIMIT 200`,
    );
    let total = 0;
    for (const row of orderIds) total += await this.applyPendingForOrder(row.order_id);
    if (total > 0) this.logger.info('payment.orphans_applied', { count: total });
    return total;
  }

  private async handleOrphanJob(job: Job): Promise<void> {
    const orderId = job.payload?.orderId as string | undefined;
    if (orderId) {
      await this.applyPendingForOrder(orderId);
      return;
    }
    await this.sweepOrphanEvents();
  }
}
