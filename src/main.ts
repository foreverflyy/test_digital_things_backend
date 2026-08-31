import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { MigrationRunner } from './database/migration.runner';
import { LoggerService } from './logging/logger.service';
import { MoneyService } from './money/money.service';
import { appConfig } from './config/app-config';
import { openApiDocument } from './docs/openapi.document';


function corsOptions() {
  const raw = appConfig.CORS_ORIGINS.trim();
  if (raw === '*') return { origin: true };
  return { origin: raw.split(',').map((value) => value.trim()).filter(Boolean) };
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  app.enableCors(corsOptions());

  if (process.env.AUTO_MIGRATE !== 'false') {
    await app.get(MigrationRunner).run();
    await app.get(MoneyService).reload();
  }

  SwaggerModule.setup('docs', app, openApiDocument, {
    jsonDocumentUrl: 'docs-json',
    customSiteTitle: 'Магазин цифровых товаров — API',
  });

  await app.listen(appConfig.PORT, '0.0.0.0');
  app.get(LoggerService).info('api.started', { port: appConfig.PORT });
}

bootstrap();
