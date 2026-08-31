export const ORDER_STATUSES = [
  'created',
  'paid',
  'delivering',
  'delivered',
  'payment_failed',
  'out_of_stock',
  'delivery_failed',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created: ['paid', 'payment_failed'],
  paid: ['delivering'],
  delivering: ['delivered', 'out_of_stock', 'delivery_failed'],
  delivered: [],
  payment_failed: ['paid'],
  out_of_stock: ['delivering'],
  delivery_failed: ['delivering'],
};

const statusesLeadingTo = (target: OrderStatus): OrderStatus[] =>
  ORDER_STATUSES.filter((status) => TRANSITIONS[status].includes(target));

export const DELIVERABLE_FROM: OrderStatus[] = statusesLeadingTo('delivering');

const SETTLED_STATUSES: OrderStatus[] = ['created', 'payment_failed', 'delivered'];

export const PAID_NOT_DELIVERED_STATUSES: OrderStatus[] = ORDER_STATUSES.filter(
  (status) => !SETTLED_STATUSES.includes(status),
);
