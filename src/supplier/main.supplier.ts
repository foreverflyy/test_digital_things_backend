import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { appConfig } from '../config/app-config';
import { LoggerService } from '../logging/logger.service';
import { SupplierModule } from './supplier.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(SupplierModule, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  await app.listen(appConfig.SUPPLIER_PORT, '0.0.0.0');
  app.get(LoggerService).info('supplier.started', {
    provider: appConfig.SUPPLIER_ID,
    port: appConfig.SUPPLIER_PORT,
  });
}

bootstrap();
