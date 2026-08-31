import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { DeliveryModule } from './delivery/delivery.module';
import { HealthController } from './health.controller';
import { LedgerModule } from './ledger/ledger.module';
import { LoggingModule } from './logging/logging.module';
import { TraceMiddleware } from './logging/trace.middleware';
import { MoneyModule } from './money/money.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { QueueModule } from './queue/queue.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    DatabaseModule,
    MoneyModule,
    QueueModule,
    CatalogModule,
    OrdersModule,
    PaymentsModule,
    DeliveryModule,
    LedgerModule,
    ReconciliationModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceMiddleware).forRoutes('*');
  }
}
