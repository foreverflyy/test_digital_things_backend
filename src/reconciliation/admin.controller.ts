import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { DeliveryService } from '../delivery/delivery.service';
import { OrdersService } from '../orders/orders.service';
import { RecoveryService } from './recovery.service';
import { ReconciliationService } from './reconciliation.service';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly recovery: RecoveryService,
    private readonly delivery: DeliveryService,
    private readonly orders: OrdersService,
  ) {}

  @Get('reconciliation')
  async report() {
    return this.reconciliation.report();
  }

  @Get('orders/:id/audit')
  async audit(@Param('id') id: string) {
    return this.reconciliation.auditOrder(id);
  }

  @Post('recovery/run')
  @HttpCode(200)
  async runRecovery() {
    return this.recovery.runAll();
  }

  @Post('orders/:id/retry-delivery')
  @HttpCode(200)
  async retryDelivery(@Param('id') id: string) {
    const outcome = await this.delivery.deliver(id, true);
    const order = await this.orders.findById(id);
    return { outcome, order: this.orders.toResponse(order) };
  }
}
