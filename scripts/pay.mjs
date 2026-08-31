import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: process.env.API_URL ?? 'http://localhost:3010' },
    sku: { type: 'string', default: 'KEY-CS2-PRIME' },
    order: { type: 'string' },
    status: { type: 'string', default: 'paid' },
    concurrency: { type: 'string', default: '1' },
    'same-event': { type: 'boolean', default: false },
    amount: { type: 'string' },
    wait: { type: 'boolean', default: true },
  },
});

const api = async (path, options = {}) => {
  const response = await fetch(`${values.api}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

let orderId = values.order;
let amount = values.amount ? Number(values.amount) : undefined;

if (!orderId) {
  const created = await api('/orders', { method: 'POST', body: { sku: values.sku } });
  if (created.status !== 201) {
    console.error('order creation failed', created);
    process.exit(1);
  }
  orderId = created.body.order_id;
  amount ??= created.body.amount;
  console.log(`created order ${orderId} for ${values.sku}, amount ${amount} ${created.body.currency}`);
} else {
  const existing = await api(`/orders/${orderId}`);
  amount ??= existing.body.amount;
}

const concurrency = Number(values.concurrency);
const sharedEventId = `evt_${randomUUID()}`;

const payloads = Array.from({ length: concurrency }, () => ({
  event_id: values['same-event'] ? sharedEventId : `evt_${randomUUID()}`,
  order_id: orderId,
  status: values.status,
  amount,
  currency: 'RUB',
  created_at: new Date().toISOString(),
}));

const startedAt = Date.now();
const responses = await Promise.all(
  payloads.map((payload) => api('/webhooks/payment', { method: 'POST', body: payload })),
);

const summary = responses.reduce((accumulator, response) => {
  const key = `${response.status}:${response.body?.result ?? 'n/a'}`;
  accumulator[key] = (accumulator[key] ?? 0) + 1;
  return accumulator;
}, {});

console.log(`sent ${concurrency} webhooks in ${Date.now() - startedAt}ms`);
console.table(summary);

if (values.wait) {
  const deadline = Date.now() + 30_000;
  let order = (await api(`/orders/${orderId}`)).body;
  while (!['delivered', 'payment_failed'].includes(order.status) && Date.now() < deadline) {
    await api('/admin/recovery/run', { method: 'POST' });
    order = (await api(`/orders/${orderId}`)).body;
  }
  console.log('final order:', order);

  const audit = (await api(`/admin/orders/${orderId}/audit`)).body;
  console.log('counters:', audit.counters);
  console.log(
    'attempts:',
    audit.attempts.map((a) => `${a.provider}#${a.attempt_no} ${a.status} ${a.request_id}`),
  );
}
