import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { LoggerService } from '../logging/logger.service';

export type LedgerKind = 'payment_captured' | 'delivery_issued';
export type LedgerAccount = 'gateway_receivable' | 'deferred_revenue' | 'revenue';

interface PostingInput {
  orderId: string;
  amountMinor: number;
  currency: string;
  ref: string;
}

const POSTINGS: Record<LedgerKind, { debit: LedgerAccount; credit: LedgerAccount }> = {
  payment_captured: { debit: 'gateway_receivable', credit: 'deferred_revenue' },
  delivery_issued: { debit: 'deferred_revenue', credit: 'revenue' },
};

@Injectable()
export class LedgerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: LoggerService,
  ) {}

  async post(kind: LedgerKind, input: PostingInput): Promise<void> {
    const posting = POSTINGS[kind];
    const txnId = randomUUID();
    const inserted = await this.db.execute(
      `INSERT INTO ledger_entries (txn_id, order_id, account, direction, amount_minor, currency_code, kind, ref)
       VALUES ($1, $2, $3, 'debit',  $5, $6, $7, $8),
              ($1, $2, $4, 'credit', $5, $6, $7, $8)
       ON CONFLICT (order_id, kind, ref, account, direction) DO NOTHING`,
      [
        txnId,
        input.orderId,
        posting.debit,
        posting.credit,
        input.amountMinor,
        input.currency,
        kind,
        input.ref,
      ],
    );

    if (inserted > 0) {
      this.logger.info('ledger.posted', {
        order_id: input.orderId,
        kind,
        amount_minor: input.amountMinor,
        currency: input.currency,
        ref: input.ref,
        debit: posting.debit,
        credit: posting.credit,
      });
    }
  }

  async balances() {
    return this.db.query<{ currency_code: string; balance: number }>(
      `SELECT currency_code,
              SUM(CASE direction WHEN 'debit' THEN amount_minor ELSE -amount_minor END)::bigint AS balance
       FROM ledger_entries
       GROUP BY currency_code`,
    );
  }

  async accountTotals() {
    return this.db.query<{ account: string; currency_code: string; balance: number }>(
      `SELECT account, currency_code,
              SUM(CASE direction WHEN 'debit' THEN amount_minor ELSE -amount_minor END)::bigint AS balance
       FROM ledger_entries
       GROUP BY account, currency_code
       ORDER BY account`,
    );
  }

  async mixedCurrencyTransactions() {
    return this.db.query<{ txn_id: string }>(
      `SELECT txn_id FROM ledger_entries
       GROUP BY txn_id HAVING count(DISTINCT currency_code) > 1`,
    );
  }

  async unbalancedTransactions() {
    return this.db.query<{ txn_id: string; balance: number }>(
      `SELECT txn_id,
              SUM(CASE direction WHEN 'debit' THEN amount_minor ELSE -amount_minor END)::bigint AS balance
       FROM ledger_entries
       GROUP BY txn_id
       HAVING SUM(CASE direction WHEN 'debit' THEN amount_minor ELSE -amount_minor END) <> 0`,
    );
  }
}
