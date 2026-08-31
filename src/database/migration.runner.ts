import { Injectable } from '@nestjs/common';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseService } from './database.service';
import { LoggerService } from '../logging/logger.service';

@Injectable()
export class MigrationRunner {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: LoggerService,
  ) {}

  private get directory(): string {
    return process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), 'migrations');
  }

  async run(): Promise<string[]> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await this.db.query<{ name: string }>('SELECT name FROM schema_migrations')).map(
        (row) => row.name,
      ),
    );

    const files = readdirSync(this.directory)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const executed: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(this.directory, file), 'utf8');
      await this.db.transaction(async () => {
        await this.db.execute(sql);
        await this.db.execute('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      });
      executed.push(file);
      this.logger.info('migration.applied', { migration: file });
    }
    return executed;
  }
}
