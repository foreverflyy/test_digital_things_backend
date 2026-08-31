import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ReportingModule } from './reporting.module';
import { ReconciliationService } from './reconciliation.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(ReportingModule, { logger: false });
  const report = await app.get(ReconciliationService).report();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await app.close();
  process.exit(report.healthy ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(2);
});
