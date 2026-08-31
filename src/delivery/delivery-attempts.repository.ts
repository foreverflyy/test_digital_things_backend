import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type AttemptStatus = 'in_flight' | 'ok' | 'failed' | 'unknown';

export interface DeliveryAttempt {
  id: number;
  order_id: string;
  provider: string;
  request_id: string;
  attempt_no: number;
  status: AttemptStatus;
  code: string | null;
  reconcile_count: number;
  error_reason: string | null;
  started_at: Date;
}

@Injectable()
export class DeliveryAttemptsRepository {
  constructor(private readonly db: DatabaseService) {}

  async open(
    orderId: string,
    provider: string,
    requestId: string,
    attemptNo: number,
  ): Promise<DeliveryAttempt> {
    const row = await this.db.queryOne<DeliveryAttempt>(
      `INSERT INTO delivery_attempts (order_id, provider, request_id, attempt_no, status)
       VALUES ($1, $2, $3, $4, 'in_flight')
       ON CONFLICT (request_id) DO UPDATE SET status = delivery_attempts.status
       RETURNING *`,
      [orderId, provider, requestId, attemptNo],
    );
    return row!;
  }

  async markOk(id: number, code: string, httpStatus: number): Promise<boolean> {
    const changed = await this.db.execute(
      `UPDATE delivery_attempts
       SET status = 'ok', code = $2, http_status = $3, finished_at = now()
       WHERE id = $1 AND status <> 'ok'`,
      [id, code, httpStatus],
    );
    return changed === 1;
  }

  async markFailed(id: number, reason: string, httpStatus: number | null): Promise<void> {
    await this.db.execute(
      `UPDATE delivery_attempts
       SET status = 'failed', error_reason = $2, http_status = $3, finished_at = now()
       WHERE id = $1 AND status NOT IN ('ok','failed')`,
      [id, reason, httpStatus],
    );
  }

  async markUnknown(id: number, reason: string): Promise<void> {
    await this.db.execute(
      `UPDATE delivery_attempts SET status = 'unknown', error_reason = $2 WHERE id = $1 AND status <> 'ok'`,
      [id, reason],
    );
  }

  async bumpReconcile(id: number): Promise<number> {
    const row = await this.db.queryOne<{ reconcile_count: number }>(
      `UPDATE delivery_attempts SET reconcile_count = reconcile_count + 1
       WHERE id = $1 RETURNING reconcile_count`,
      [id],
    );
    return row?.reconcile_count ?? 0;
  }

  async openAttemptsFor(orderId: string): Promise<DeliveryAttempt[]> {
    return this.db.query<DeliveryAttempt>(
      `SELECT * FROM delivery_attempts
       WHERE order_id = $1 AND status IN ('in_flight','unknown')
       ORDER BY id`,
      [orderId],
    );
  }

  async ordersWithOpenAttempts(olderThanMs: number, limit = 100): Promise<string[]> {
    const rows = await this.db.query<{ order_id: string }>(
      `SELECT DISTINCT order_id FROM delivery_attempts
       WHERE status IN ('in_flight','unknown')
         AND started_at < now() - make_interval(secs => $1)
       LIMIT $2`,
      [olderThanMs / 1000, limit],
    );
    return rows.map((row) => row.order_id);
  }

  async successfulFor(orderId: string): Promise<DeliveryAttempt | undefined> {
    return this.db.queryOne<DeliveryAttempt>(
      `SELECT * FROM delivery_attempts WHERE order_id = $1 AND status = 'ok'`,
      [orderId],
    );
  }
}
