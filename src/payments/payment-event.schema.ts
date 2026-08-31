import { z } from 'zod';

export const paymentWebhookSchema = z.object({
  event_id: z.string().min(1).max(128),
  order_id: z.string().min(1).max(64),
  status: z.enum(['paid', 'failed']),
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
  created_at: z.string().datetime({ offset: true }),
});

export type PaymentWebhookPayload = z.infer<typeof paymentWebhookSchema>;

export type ApplyResult =
  | 'applied'
  | 'duplicate'
  | 'order_missing'
  | 'ignored_stale'
  | 'ignored_not_pending'
  | 'amount_mismatch';
