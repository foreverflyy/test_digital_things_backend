import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { appConfig } from '../config/app-config';
import { LoggerService } from '../logging/logger.service';
import { SupplierModule } from './supplier.module';
import { supplierOpenApiDocument } from '../docs/supplier-openapi.document';


function corsOptions() {
  const raw = appConfig.CORS_ORIGINS.trim();
  if (raw === '*') return { origin: true };
  return { origin: raw.split(',').map((value) => value.trim()).filter(Boolean) };
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(SupplierModule, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  app.enableCors(corsOptions());
  SwaggerModule.setup('docs', app, supplierOpenApiDocument, {
    jsonDocumentUrl: 'docs-json',
    customSiteTitle: `Заглушка поставщика ${appConfig.SUPPLIER_ID}`,
  });

  await app.listen(appConfig.SUPPLIER_PORT, '0.0.0.0');
  app.get(LoggerService).info('supplier.started', {
    provider: appConfig.SUPPLIER_ID,
    port: appConfig.SUPPLIER_PORT,
  });
}

bootstrap();
