import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersModule } from '../orders/orders.module';
import { DeliveryAttemptsRepository } from './delivery-attempts.repository';
import { DeliveryService } from './delivery.service';
import { suppliersProvider } from './suppliers/suppliers.provider';

@Module({
  imports: [OrdersModule, LedgerModule],
  providers: [DeliveryService, DeliveryAttemptsRepository, suppliersProvider],
  exports: [DeliveryService, DeliveryAttemptsRepository],
})
export class DeliveryModule {}
