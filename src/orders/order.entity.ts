import { OrderStatus } from './order-status';

export interface Order {
  id: string;
  sku: string;
  price_minor: number;
  currency_code: string;
  status: OrderStatus;
  delivered_code: string | null;
  delivered_at: Date | null;
  delivery_attempt_id: number | null;
  delivery_attempt_no: number;
  last_payment_event_at: Date | null;
  paid_at: Date | null;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
}
