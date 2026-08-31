import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MaintenanceModule } from './maintenance.module';
import { MigrationRunner } from './migration.runner';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(MaintenanceModule, { logger: false });
  const executed = await app.get(MigrationRunner).run();
  process.stdout.write(
    executed.length ? `applied: ${executed.join(', ')}\n` : 'nothing to apply\n',
  );
  await app.close();
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
