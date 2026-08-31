import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SupplierService } from './supplier.service';

const issueSchema = z.object({
  request_id: z.string().min(1),
  sku: z.string().min(1),
  order_id: z.string().min(1),
});

const controlSchema = z.object({
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

@Controller()
export class SupplierController {
  constructor(private readonly supplier: SupplierService) {}

  @Post('issue')
  async issue(
    @Body(new ZodValidationPipe(issueSchema)) body: z.infer<typeof issueSchema>,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.supplier.issue(body.request_id, body.sku, body.order_id);

    if (result.kind === 'hang') {
      await this.supplier.hang();
      res.status(504).json({ status: 'error', reason: 'gateway_timeout' });
      return;
    }
    if (result.kind === 'ok') {
      res.status(200).json({ status: 'ok', request_id: body.request_id, code: result.code });
      return;
    }
    if (result.kind === 'out_of_stock') {
      res.status(409).json({ status: 'error', reason: 'out_of_stock' });
      return;
    }
    if (result.kind === 'down') {
      res.status(503).json({ status: 'error', reason: 'provider_down' });
      return;
    }
    res.status(500).json({ status: 'error', reason: 'internal_error' });
  }

  @Get('stock')
  stock() {
    return { provider: this.supplier.provider, stock: this.supplier.stock() };
  }

  @Get('healthz')
  health() {
    return { status: 'ok', provider: this.supplier.provider };
  }

  @Get('_control')
  readControl() {
    return this.supplier.control();
  }

  @Post('_control')
  @HttpCode(200)
  writeControl(@Body(new ZodValidationPipe(controlSchema)) body: z.infer<typeof controlSchema>) {
    return this.supplier.updateControl(body);
  }

  @Post('_control/reset')
  @HttpCode(200)
  resetControl() {
    return this.supplier.resetControl();
  }

  @Post('_control/restock')
  @HttpCode(200)
  restock(@Body(new ZodValidationPipe(restockSchema)) body: z.infer<typeof restockSchema>) {
    return { added: this.supplier.restock(body.sku, body.count) };
  }

  @Get('_state/issued/:requestId')
  issued(@Param('requestId') requestId: string) {
    const record = this.supplier.issuedByRequestId(requestId);
    return { issued: record ? { provider: this.supplier.provider, ...record } : null };
  }

  @Get('_state/order/:orderId')
  issuedForOrder(@Param('orderId') orderId: string) {
    return {
      issued: this.supplier
        .issuedForOrder(orderId)
        .map((record) => ({ provider: this.supplier.provider, ...record })),
    };
  }
}
