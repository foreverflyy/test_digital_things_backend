import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface Currency {
  code: string;
  exponent: number;
  symbol: string;
}

@Injectable()
export class MoneyService implements OnModuleInit {
  private readonly currencies = new Map<string, Currency>();

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    const rows = await this.db.query<Currency>(
      'SELECT code, exponent, symbol FROM currencies',
    );
    this.currencies.clear();
    for (const row of rows) this.currencies.set(row.code, row);
  }

  isKnown(code: string): boolean {
    return this.currencies.has(code);
  }

  exponentOf(code: string): number {
    const currency = this.currencies.get(code);
    if (!currency) throw new Error(`unknown currency ${code}`);
    return currency.exponent;
  }

  toMinor(major: number, code: string): number {
    const factor = 10 ** this.exponentOf(code);
    const minor = Math.round(major * factor);
    if (!Number.isSafeInteger(minor)) throw new Error(`amount out of range: ${major} ${code}`);
    return minor;
  }

  toMajor(minor: number, code: string): number {
    return minor / 10 ** this.exponentOf(code);
  }
}
