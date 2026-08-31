import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { MoneyService } from '../money/money.service';

interface ProductRow {
  sku: string;
  name: string;
  type: string;
  price_minor: number;
  currency_code: string;
  stock_count: number;
  popularity: number;
  image: string | null;
}

export interface ShowcaseQuery {
  type?: string;
  cursor?: string;
  limit: number;
  inStockOnly: boolean;
}

function encodeCursor(row: ProductRow): string {
  return Buffer.from(`${row.popularity}|${row.sku}`).toString('base64url');
}

function decodeCursor(cursor: string): { popularity: number; sku: string } | null {
  try {
    const [popularity, sku] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (sku === undefined) return null;
    return { popularity: Number(popularity), sku };
  } catch {
    return null;
  }
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly db: DatabaseService,
    private readonly money: MoneyService,
  ) {}

  async showcase(query: ShowcaseQuery) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.db.query<ProductRow>(
      `SELECT sku, name, type, price_minor, currency_code, stock_count, popularity, image
       FROM products
       WHERE is_active
         AND ($1::text IS NULL OR type = $1)
         AND ($2::int IS NULL OR (popularity, sku) < ($2::int, $3::text))
         AND ($4::boolean IS FALSE OR stock_count > 0)
       ORDER BY popularity DESC, sku DESC
       LIMIT $5`,
      [
        query.type ?? null,
        cursor?.popularity ?? null,
        cursor?.sku ?? null,
        query.inStockOnly,
        query.limit,
      ],
    );

    return {
      items: rows.map((row) => this.toResponse(row)),
      next_cursor: rows.length === query.limit ? encodeCursor(rows[rows.length - 1]) : null,
    };
  }

  async findBySku(sku: string) {
    const row = await this.db.queryOne<ProductRow>(
      `SELECT sku, name, type, price_minor, currency_code, stock_count, popularity, image
       FROM products WHERE sku = $1`,
      [sku],
    );
    if (!row) throw new NotFoundException({ error: 'sku_not_found', sku });
    return this.toResponse(row);
  }

  async explainShowcase(type: string) {
    return this.db.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
       SELECT sku, name, price_minor, currency_code, stock_count
       FROM products
       WHERE is_active AND type = $1
       ORDER BY popularity DESC, sku DESC
       LIMIT 24`,
      [type],
    );
  }

  private toResponse(row: ProductRow) {
    return {
      sku: row.sku,
      name: row.name,
      type: row.type,
      price_minor: row.price_minor,
      price: this.money.toMajor(row.price_minor, row.currency_code),
      currency: row.currency_code,
      in_stock: row.stock_count > 0,
      stock_count: row.stock_count,
      image: row.image,
    };
  }
}
