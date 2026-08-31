import { Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import { LedgerService } from '../ledger/ledger.service';
import { PAID_NOT_DELIVERED_STATUSES } from '../orders/order-status';

export interface ReconciliationReport {
  generated_at: string;
  paid_not_delivered: Array<Record<string, unknown>>;
  delivered_not_paid: Array<Record<string, unknown>>;
  stuck_delivering: Array<Record<string, unknown>>;
  unknown_attempts: Array<Record<string, unknown>>;
  unapplied_events: Array<Record<string, unknown>>;
  ledger: {
    balances: Array<{ currency_code: string; balance: number }>;
    accounts: Array<{ account: string; currency_code: string; balance: number }>;
    unbalanced_transactions: string[];
    mixed_currency_transactions: string[];
    deferred_revenue_minor: number;
    paid_not_delivered_minor: number;
    matches_paid_not_delivered: boolean;
  };
  healthy: boolean;
}

@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DatabaseService,
    private readonly ledger: LedgerService,
  ) {}

  async auditOrder(orderId: string) {
    const [order] = await this.db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    const events = await this.db.query(
      `SELECT event_id, status, amount_minor, currency_code, occurred_at, applied_at, apply_result
       FROM payment_events WHERE order_id = $1 ORDER BY received_at`,
      [orderId],
    );
    const attempts = await this.db.query(
      `SELECT id, provider, request_id, attempt_no, status, code, error_reason, reconcile_count,
              started_at, finished_at
       FROM delivery_attempts WHERE order_id = $1 ORDER BY id`,
      [orderId],
    );
    const ledger = await this.db.query(
      `SELECT txn_id, account, direction, amount_minor, currency_code, kind, ref, created_at
       FROM ledger_entries WHERE order_id = $1 ORDER BY id`,
      [orderId],
    );

    return {
      order: order ?? null,
      events,
      attempts,
      ledger,
      counters: {
        events: events.length,
        successful_attempts: attempts.filter((row) => row.status === 'ok').length,
        delivery_issued_postings: ledger.filter((row) => row.kind === 'delivery_issued').length,
        payment_captured_postings: ledger.filter((row) => row.kind === 'payment_captured').length,
      },
    };
  }

  async report(): Promise<ReconciliationReport> {
    const paidNotDelivered = await this.db.query(
      `SELECT id AS order_id, sku, status, price_minor, currency_code, paid_at, updated_at
       FROM orders
       WHERE status = ANY($1::text[])
       ORDER BY paid_at NULLS LAST
       LIMIT 500`,
      [PAID_NOT_DELIVERED_STATUSES],
    );

    const deliveredNotPaid = await this.db.query(
      `SELECT o.id AS order_id, o.sku, o.status, o.delivered_code, o.delivered_at
       FROM orders o
       WHERE o.delivered_code IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM ledger_entries l
           WHERE l.order_id = o.id AND l.kind = 'payment_captured'
         )
       LIMIT 500`,
    );

    const stuckDelivering = await this.db.query(
      `SELECT id AS order_id, sku, updated_at
       FROM orders
       WHERE status = 'delivering' AND updated_at < now() - make_interval(secs => $1)
       LIMIT 500`,
      [this.config.STUCK_ORDER_AGE_MS / 1000],
    );

    const unknownAttempts = await this.db.query(
      `SELECT id, order_id, provider, request_id, reconcile_count, started_at
       FROM delivery_attempts
       WHERE status IN ('unknown','in_flight')
       ORDER BY started_at
       LIMIT 500`,
    );

    const unappliedEvents = await this.db.query(
      `SELECT event_id, order_id, status, apply_result, received_at
       FROM payment_events
       WHERE applied_at IS NULL
       ORDER BY received_at
       LIMIT 500`,
    );

    const balances = await this.ledger.balances();
    const accounts = await this.ledger.accountTotals();
    const unbalanced = await this.ledger.unbalancedTransactions();
    const mixed = await this.ledger.mixedCurrencyTransactions();

    const deferred = accounts
      .filter((row) => row.account === 'deferred_revenue')
      .reduce((sum, row) => sum + Number(row.balance), 0);
    const paidNotDeliveredMinor = paidNotDelivered.reduce(
      (sum, row) => sum + Number(row.price_minor),
      0,
    );

    const matches = -deferred === paidNotDeliveredMinor;
    const balanced = balances.every((row) => Number(row.balance) === 0);

    return {
      generated_at: new Date().toISOString(),
      paid_not_delivered: paidNotDelivered,
      delivered_not_paid: deliveredNotPaid,
      stuck_delivering: stuckDelivering,
      unknown_attempts: unknownAttempts,
      unapplied_events: unappliedEvents,
      ledger: {
        balances: balances.map((row) => ({
          currency_code: row.currency_code,
          balance: Number(row.balance),
        })),
        accounts: accounts.map((row) => ({ ...row, balance: Number(row.balance) })),
        unbalanced_transactions: unbalanced.map((row) => row.txn_id),
        mixed_currency_transactions: mixed.map((row) => row.txn_id),
        deferred_revenue_minor: -deferred,
        paid_not_delivered_minor: paidNotDeliveredMinor,
        matches_paid_not_delivered: matches,
      },
      healthy:
        balanced &&
        matches &&
        unbalanced.length === 0 &&
        mixed.length === 0 &&
        deliveredNotPaid.length === 0,
    };
  }
}
