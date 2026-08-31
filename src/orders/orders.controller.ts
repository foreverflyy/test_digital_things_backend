import { Body, Controller, Get, Headers, Param, Post, UsePipes } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OrdersService } from './orders.service';

const createOrderSchema = z.object({
  sku: z.string().min(1),
  order_id: z.string().min(3).max(64).optional(),
});

type CreateOrderBody = z.infer<typeof createOrderSchema>;

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(createOrderSchema))
  async create(
    @Body() body: CreateOrderBody,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const order = await this.orders.create({
      sku: body.sku,
      orderId: body.order_id,
      idempotencyKey: idempotencyKey || undefined,
    });
    return this.orders.toResponse(order);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.orders.toResponse(await this.orders.findById(id));
  }
}
