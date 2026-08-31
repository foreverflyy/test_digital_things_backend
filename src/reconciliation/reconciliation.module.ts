import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminController } from './admin.controller';
import { ReconciliationService } from './reconciliation.service';
import { RecoveryService } from './recovery.service';
import { SuppliersAdminService } from './suppliers-admin.service';

@Module({
  imports: [OrdersModule, PaymentsModule, DeliveryModule, LedgerModule],
  controllers: [AdminController],
  providers: [ReconciliationService, RecoveryService, SuppliersAdminService],
  exports: [ReconciliationService, RecoveryService, SuppliersAdminService],
})
export class ReconciliationModule {}
