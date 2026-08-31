import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MaintenanceModule } from './maintenance.module';
import { MigrationRunner } from './migration.runner';
import { SeedService } from './seed.service';

async function main(): Promise<void> {
  process.env.WORKER_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(MaintenanceModule, { logger: false });
  await app.get(MigrationRunner).run();
  await app.get(SeedService).run();
  process.stdout.write('seed completed\n');
  await app.close();
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
