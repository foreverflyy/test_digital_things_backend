import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { LoggerService } from '../logging/logger.service';
import { MoneyService } from '../money/money.service';
import { QueueService } from '../queue/queue.service';
import { JOB_NAMES } from '../queue/queue.types';
import { Order } from './order.entity';
import { DELIVERABLE_FROM, OrderStatus } from './order-status';

export interface CreateOrderInput {
  sku: string;
  orderId?: string;
  idempotencyKey?: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly queue: QueueService,
    private readonly money: MoneyService,
    private readonly logger: LoggerService,
  ) {}

  async create(input: CreateOrderInput): Promise<Order> {
    if (input.idempotencyKey) {
      const existing = await this.db.queryOne<Order>(
        'SELECT * FROM orders WHERE idempotency_key = $1',
        [input.idempotencyKey],
      );
      if (existing) return existing;
    }

    const product = await this.db.queryOne<{
      sku: string;
      price_minor: number;
      currency_code: string;
      is_active: boolean;
    }>('SELECT sku, price_minor, currency_code, is_active FROM products WHERE sku = $1', [
      input.sku,
    ]);

    if (!product) throw new NotFoundException({ error: 'sku_not_found', sku: input.sku });
    if (!product.is_active) throw new BadRequestException({ error: 'sku_inactive', sku: input.sku });

    const id = input.orderId ?? `ord_${randomBytes(8).toString('hex')}`;

    const order = await this.db.transaction(async () => {
      const created = await this.db.queryOne<Order>(
        `INSERT INTO orders (id, sku, price_minor, currency_code, status, idempotency_key)
         VALUES ($1, $2, $3, $4, 'created', $5)
         ON CONFLICT (id) DO NOTHING
         RETURNING *`,
        [id, product.sku, product.price_minor, product.currency_code, input.idempotencyKey ?? null],
      );
      if (!created) {
        const existing = await this.db.queryOne<Order>('SELECT * FROM orders WHERE id = $1', [id]);
        if (!existing) throw new BadRequestException({ error: 'order_conflict', order_id: id });
        return existing;
      }
      await this.queue.enqueue(
        JOB_NAMES.applyOrphanEvents,
        { orderId: id },
        { dedupeKey: `orphan:${id}` },
      );
      return created;
    });

    this.logger.info('order.created', {
      order_id: order.id,
      sku: order.sku,
      amount_minor: order.price_minor,
      currency: order.currency_code,
    });
    return order;
  }

  async findById(id: string): Promise<Order> {
    const order = await this.db.queryOne<Order>('SELECT * FROM orders WHERE id = $1', [id]);
    if (!order) throw new NotFoundException({ error: 'order_not_found', order_id: id });
    return order;
  }

  async findByIdOrNull(id: string): Promise<Order | undefined> {
    return this.db.queryOne<Order>('SELECT * FROM orders WHERE id = $1', [id]);
  }

  async lockById(id: string): Promise<Order | undefined> {
    return this.db.queryOne<Order>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
  }

  async markPaid(id: string, occurredAt: Date): Promise<boolean> {
    const changed = await this.db.execute(
      `UPDATE orders
       SET status = 'paid', paid_at = now(), last_payment_event_at = $2, updated_at = now()
       WHERE id = $1
         AND (
           status = 'created'
           OR (
             status = 'payment_failed'
             AND (last_payment_event_at IS NULL OR last_payment_event_at < $2)
           )
         )`,
      [id, occurredAt],
    );
    return changed === 1;
  }

  async markPaymentFailed(id: string, occurredAt: Date): Promise<boolean> {
    const changed = await this.db.execute(
      `UPDATE orders
       SET status = 'payment_failed', last_payment_event_at = $2, updated_at = now()
       WHERE id = $1 AND status = 'created'`,
      [id, occurredAt],
    );
    return changed === 1;
  }

  async touchPaymentEventAt(id: string, occurredAt: Date): Promise<void> {
    await this.db.execute(
      `UPDATE orders SET last_payment_event_at = GREATEST(COALESCE(last_payment_event_at, $2), $2)
       WHERE id = $1`,
      [id, occurredAt],
    );
  }

  async beginDelivering(id: string, resumeStuckAfterMs = 0): Promise<Order | undefined> {
    return this.db.queryOne<Order>(
      `UPDATE orders SET status = 'delivering', updated_at = now()
       WHERE id = $1
         AND (
           status = ANY($2::text[])
           OR (status = 'delivering' AND updated_at < now() - make_interval(secs => $3))
         )
       RETURNING *`,
      [id, DELIVERABLE_FROM, resumeStuckAfterMs / 1000],
    );
  }

  async completeDelivery(id: string, code: string, attemptId: number): Promise<boolean> {
    const changed = await this.db.execute(
      `UPDATE orders
       SET status = 'delivered', delivered_code = $2, delivered_at = now(),
           delivery_attempt_id = $3, updated_at = now()
       WHERE id = $1 AND status = 'delivering' AND delivered_code IS NULL`,
      [id, code, attemptId],
    );
    return changed === 1;
  }

  async failDelivery(id: string, status: Extract<OrderStatus, 'out_of_stock' | 'delivery_failed'>) {
    await this.db.execute(
      `UPDATE orders SET status = $2, updated_at = now()
       WHERE id = $1 AND status = 'delivering'`,
      [id, status],
    );
  }

  async nextAttemptNo(id: string): Promise<number> {
    const row = await this.db.queryOne<{ delivery_attempt_no: number }>(
      `UPDATE orders SET delivery_attempt_no = delivery_attempt_no + 1, updated_at = now()
       WHERE id = $1 RETURNING delivery_attempt_no`,
      [id],
    );
    return row?.delivery_attempt_no ?? 1;
  }

  toResponse(order: Order) {
    return {
      order_id: order.id,
      sku: order.sku,
      status: order.status,
      amount_minor: order.price_minor,
      amount: this.money.toMajor(order.price_minor, order.currency_code),
      currency: order.currency_code,
      code: order.delivered_code,
      delivered_at: order.delivered_at,
      created_at: order.created_at,
      updated_at: order.updated_at,
    };
  }
}
