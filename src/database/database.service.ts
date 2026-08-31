import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { AppConfig, CONFIG } from '../config/app-config';
import { LoggerService } from '../logging/logger.service';

types.setTypeParser(types.builtins.INT8, (value) => Number(value));

type Executor = Pick<Pool, 'query'>;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly ambient = new AsyncLocalStorage<PoolClient>();

  constructor(
    @Inject(CONFIG) config: AppConfig,
    private readonly logger: LoggerService,
  ) {
    this.pool = new Pool({ connectionString: config.DATABASE_URL, max: 20 });
    this.pool.on('error', (error) => {
      this.logger.error('database.pool_error', { error: error.message });
    });
  }

  private get executor(): Executor {
    return this.ambient.getStore() ?? this.pool;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.executor.query<T>(text, params as never[]);
    return result.rows;
  }

  async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    const rows = await this.query<T>(text, params);
    return rows[0];
  }

  async execute(text: string, params: unknown[] = []): Promise<number> {
    const result = await this.executor.query(text, params as never[]);
    return result.rowCount ?? 0;
  }

  async withAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [key],
      );
      if (!result.rows[0]?.locked) return null;
      try {
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
      }
    } finally {
      client.release();
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const existing = this.ambient.getStore();
    if (existing) return fn();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.ambient.run(client, fn);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
