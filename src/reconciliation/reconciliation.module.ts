import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminController } from './admin.controller';
import { ReconciliationService } from './reconciliation.service';
import { RecoveryService } from './recovery.service';

@Module({
  imports: [OrdersModule, PaymentsModule, DeliveryModule, LedgerModule],
  controllers: [AdminController],
  providers: [ReconciliationService, RecoveryService],
  exports: [ReconciliationService, RecoveryService],
})
export class ReconciliationModule {}
