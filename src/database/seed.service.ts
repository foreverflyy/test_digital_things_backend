import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseService } from './database.service';
import { LoggerService } from '../logging/logger.service';

interface CatalogProduct {
  sku: string;
  name: string;
  type: string;
  price: number;
  currency: string;
  image: string;
}

const CURRENCIES = [{ code: 'RUB', exponent: 2, symbol: '₽' }];

@Injectable()
export class SeedService {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: LoggerService,
  ) {}

  private read<T>(file: string): T {
    const directory = process.env.SEED_DIR ?? resolve(process.cwd(), 'seed');
    return JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as T;
  }

  async run(): Promise<void> {
    await this.seedCurrencies();
    await this.seedProducts();
    await this.seedPerformanceCatalog();
    await this.db.execute('VACUUM ANALYZE products');
  }

  private async seedCurrencies(): Promise<void> {
    for (const currency of CURRENCIES) {
      await this.db.execute(
        `INSERT INTO currencies (code, exponent, symbol) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET exponent = EXCLUDED.exponent, symbol = EXCLUDED.symbol`,
        [currency.code, currency.exponent, currency.symbol],
      );
    }
  }

  private async seedProducts(): Promise<void> {
    const { products } = this.read<{ products: CatalogProduct[] }>('catalog.json');
    for (const [index, product] of products.entries()) {
      const exponent = CURRENCIES.find((c) => c.code === product.currency)!.exponent;
      await this.db.execute(
        `INSERT INTO products (sku, name, type, price_minor, currency_code, image, popularity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (sku) DO UPDATE SET
           name = EXCLUDED.name, type = EXCLUDED.type,
           price_minor = EXCLUDED.price_minor, currency_code = EXCLUDED.currency_code,
           image = EXCLUDED.image, popularity = EXCLUDED.popularity`,
        [
          product.sku,
          product.name,
          product.type,
          Math.round(product.price * 10 ** exponent),
          product.currency,
          product.image,
          1000 - index * 10,
        ],
      );
    }
    this.logger.info('seed.products', { count: products.length });
  }

  private async seedPerformanceCatalog(): Promise<void> {
    const total = Number(process.env.SEED_PERF_SKUS ?? 5000);
    if (total <= 0) return;

    const existing = await this.db.queryOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM products WHERE sku LIKE 'PERF-%'`,
    );
    if ((existing?.count ?? 0) >= total) return;

    await this.db.execute(
      `INSERT INTO products (sku, name, type, price_minor, currency_code, image, popularity, stock_count, is_active)
       SELECT
         'PERF-' || lpad(i::text, 6, '0'),
         'Performance SKU ' || i,
         (ARRAY['topup','key','subscription','giftcard'])[1 + (i % 4)],
         (100 + (i % 900)) * 100,
         'RUB',
         'assets/placeholder.png',
         (i * 7919) % 1000,
         (i * 13) % 25,
         (i % 97) <> 0
       FROM generate_series(1, $1) AS i
       ON CONFLICT (sku) DO NOTHING`,
      [total],
    );

    this.logger.info('seed.performance_catalog', { total });
  }

}
