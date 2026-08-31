import { Injectable, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LoggerService } from '../logging/logger.service';
import { appConfig } from '../config/app-config';

export interface SupplierControl {
  failure_rate: number;
  timeout_rate: number;
  latency_ms: number;
  hard_down: boolean;
  force_out_of_stock: boolean;
  issue_then_hang: boolean;
}

export interface IssuedRecord {
  request_id: string;
  order_id: string;
  sku: string;
  code: string;
  issued_at: string;
}

export type IssueResult =
  | { kind: 'ok'; code: string; replayed: boolean }
  | { kind: 'out_of_stock' }
  | { kind: 'down' }
  | { kind: 'internal_error' }
  | { kind: 'hang' };

const HANG_MS = 60_000;

const DEFAULT_CONTROL: SupplierControl = {
  failure_rate: 0,
  timeout_rate: 0,
  latency_ms: 0,
  hard_down: false,
  force_out_of_stock: false,
  issue_then_hang: false,
};

@Injectable()
export class SupplierService implements OnModuleInit {
  readonly provider = appConfig.SUPPLIER_ID;

  private readonly available = new Map<string, string[]>();
  private readonly issuedByRequest = new Map<string, IssuedRecord>();
  private settings: SupplierControl = { ...DEFAULT_CONTROL };

  constructor(private readonly logger: LoggerService) {}

  onModuleInit(): void {
    this.loadKeyPool();
  }

  private loadKeyPool(): void {
    const directory = process.env.SEED_DIR ?? resolve(process.cwd(), 'seed');
    const { keys } = JSON.parse(
      readFileSync(resolve(directory, 'keys.json'), 'utf8'),
    ) as { keys: string[] };
    const { products } = JSON.parse(
      readFileSync(resolve(directory, 'catalog.json'), 'utf8'),
    ) as { products: Array<{ sku: string }> };

    const share = keys.filter((_, index) =>
      this.provider === 'A' ? index < 30 : index >= 30,
    );
    const offset = this.provider === 'A' ? 0 : 30;

    for (const [index, code] of share.entries()) {
      const sku = products[(index + offset) % products.length].sku;
      this.push(sku, code);
    }

    const extra = Number(process.env.SUPPLIER_EXTRA_KEYS_PER_SKU ?? 40);
    for (const product of products) {
      for (let i = 0; i < extra; i += 1) this.push(product.sku, randomCode());
    }

    this.logger.info('supplier.pool_loaded', {
      provider: this.provider,
      from_task_pool: share.length,
      generated_per_sku: extra,
    });
  }

  private push(sku: string, code: string): void {
    const pool = this.available.get(sku);
    if (pool) pool.push(code);
    else this.available.set(sku, [code]);
  }

  control(): SupplierControl {
    return { ...this.settings };
  }

  updateControl(patch: Partial<SupplierControl>): SupplierControl {
    this.settings = { ...this.settings, ...patch };
    this.logger.info('supplier.control_updated', { provider: this.provider, ...patch });
    return this.control();
  }

  resetControl(): SupplierControl {
    this.settings = { ...DEFAULT_CONTROL };
    this.logger.info('supplier.control_reset', { provider: this.provider });
    return this.control();
  }

  async issue(requestId: string, sku: string, orderId: string): Promise<IssueResult> {
    const replay = this.issuedByRequest.get(requestId);
    if (replay) {
      this.logger.info('supplier.replay', {
        provider: this.provider,
        request_id: requestId,
        code: replay.code,
      });
      return { kind: 'ok', code: replay.code, replayed: true };
    }

    if (this.settings.hard_down) return { kind: 'down' };
    if (this.settings.latency_ms > 0) await delay(this.settings.latency_ms);
    if (Math.random() < this.settings.timeout_rate) return { kind: 'hang' };
    if (Math.random() < this.settings.failure_rate) return { kind: 'internal_error' };
    if (this.settings.force_out_of_stock) return { kind: 'out_of_stock' };

    const code = this.available.get(sku)?.shift();
    if (!code) return { kind: 'out_of_stock' };

    this.issuedByRequest.set(requestId, {
      request_id: requestId,
      order_id: orderId,
      sku,
      code,
      issued_at: new Date().toISOString(),
    });

    this.logger.info('supplier.issued', {
      provider: this.provider,
      request_id: requestId,
      order_id: orderId,
      sku,
      code,
    });

    if (this.settings.issue_then_hang) return { kind: 'hang' };
    return { kind: 'ok', code, replayed: false };
  }

  stock(): Array<{ sku: string; available: number }> {
    return [...this.available.entries()].map(([sku, codes]) => ({
      sku,
      available: codes.length,
    }));
  }

  issuedByRequestId(requestId: string): IssuedRecord | null {
    return this.issuedByRequest.get(requestId) ?? null;
  }

  issuedForOrder(orderId: string): IssuedRecord[] {
    return [...this.issuedByRequest.values()].filter((record) => record.order_id === orderId);
  }

  restock(sku: string, count: number): number {
    for (let i = 0; i < count; i += 1) this.push(sku, randomCode());
    this.logger.info('supplier.restocked', { provider: this.provider, sku, count });
    return count;
  }

  hang(): Promise<void> {
    return delay(HANG_MS);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const group = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}
