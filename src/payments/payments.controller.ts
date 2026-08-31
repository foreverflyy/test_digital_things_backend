import { Body, Controller, HttpCode, Post, UsePipes } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PaymentWebhookPayload, paymentWebhookSchema } from './payment-event.schema';
import { PaymentsService } from './payments.service';

@Controller('webhooks')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payment')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(paymentWebhookSchema))
  async receive(@Body() payload: PaymentWebhookPayload) {
    return this.payments.handleWebhook(payload);
  }
}
