import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LoggerService } from '../logging/logger.service';
import { DatabaseService } from '../database/database.service';
import { ProviderId, SuppliersAdminService } from './suppliers-admin.service';
import { DeliveryService } from '../delivery/delivery.service';
import { OrdersService } from '../orders/orders.service';
import { RecoveryService } from './recovery.service';
import { ReconciliationService } from './reconciliation.service';

const supplierControlSchema = z.object({
  failure_rate: z.number().min(0).max(1).optional(),
  timeout_rate: z.number().min(0).max(1).optional(),
  latency_ms: z.number().int().min(0).max(30000).optional(),
  hard_down: z.boolean().optional(),
  force_out_of_stock: z.boolean().optional(),
  issue_then_hang: z.boolean().optional(),
});

const restockSchema = z.object({
  sku: z.string().min(1),
  count: z.number().int().min(1).max(1000),
});

@Controller('admin')
export class AdminController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly recovery: RecoveryService,
    private readonly delivery: DeliveryService,
    private readonly orders: OrdersService,
    private readonly suppliers: SuppliersAdminService,
    private readonly db: DatabaseService,
  ) {}

  private provider(value: string): ProviderId {
    if (value !== 'A' && value !== 'B') {
      throw new BadRequestException({ error: 'unknown_provider', provider: value });
    }
    return value;
  }

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

  @Get('logs')
  logs(
    @Query('order_id') orderId?: string,
    @Query('event') event?: string,
    @Query('limit') limit?: string,
  ) {
    return {
      records: LoggerService.recent({
        orderId,
        event,
        limit: Math.min(Number(limit) || 100, 500),
      }),
    };
  }

  @Get('jobs')
  async jobs() {
    const queue = await this.db.query(
      `SELECT name, status, count(*)::int AS count
       FROM jobs GROUP BY name, status ORDER BY name, status`,
    );
    const schedules = await this.db.query(
      `SELECT name, interval_ms, last_run_at, next_run_at FROM schedules ORDER BY name`,
    );
    const failing = await this.db.query(
      `SELECT id, name, attempts, last_error, run_at FROM jobs
       WHERE status IN ('pending','failed') AND last_error IS NOT NULL
       ORDER BY updated_at DESC LIMIT 20`,
    );
    return { queue, schedules, failing };
  }

  @Get('suppliers')
  suppliersOverview() {
    return this.suppliers.overview();
  }

  @Post('suppliers/:provider/control')
  @HttpCode(200)
  setSupplierControl(
    @Param('provider') provider: string,
    @Body(new ZodValidationPipe(supplierControlSchema)) body: z.infer<typeof supplierControlSchema>,
  ) {
    return this.suppliers.setControl(this.provider(provider), body);
  }

  @Post('suppliers/:provider/control/reset')
  @HttpCode(200)
  resetSupplierControl(@Param('provider') provider: string) {
    return this.suppliers.resetControl(this.provider(provider));
  }

  @Post('suppliers/:provider/restock')
  @HttpCode(200)
  restockSupplier(
    @Param('provider') provider: string,
    @Body(new ZodValidationPipe(restockSchema)) body: z.infer<typeof restockSchema>,
  ) {
    return this.suppliers.restock(this.provider(provider), body.sku, body.count);
  }

  @Post('orders/:id/retry-delivery')
  @HttpCode(200)
  async retryDelivery(@Param('id') id: string) {
    const outcome = await this.delivery.deliver(id, true);
    const order = await this.orders.findById(id);
    return { outcome, order: this.orders.toResponse(order) };
  }
}
