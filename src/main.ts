import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MigrationRunner } from './database/migration.runner';
import { LoggerService } from './logging/logger.service';
import { MoneyService } from './money/money.service';
import { appConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();

  if (process.env.AUTO_MIGRATE !== 'false') {
    await app.get(MigrationRunner).run();
    await app.get(MoneyService).reload();
  }

  await app.listen(appConfig.PORT, '0.0.0.0');
  app.get(LoggerService).info('api.started', { port: appConfig.PORT });
}

bootstrap();
