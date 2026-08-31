import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const API_URL = process.env.API_URL ?? 'http://localhost:3010';
export const SUPPLIERS = {
  A: process.env.SUPPLIER_A_URL ?? 'http://localhost:4001',
  B: process.env.SUPPLIER_B_URL ?? 'http://localhost:4002',
};

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { status: response.status, body };
}

export const api = (path, options) => request(`${API_URL}${path}`, options);
export const supplier = (provider, path, options) =>
  request(`${SUPPLIERS[provider]}${path}`, options);

const DEFAULT_CONTROL = {
  failure_rate: 0,
  timeout_rate: 0,
  latency_ms: 0,
  hard_down: false,
  force_out_of_stock: false,
  issue_then_hang: false,
};

export async function setControl(provider, patch) {
  const { status } = await supplier(provider, '/_control', {
    method: 'POST',
    body: { ...DEFAULT_CONTROL, ...patch },
  });
  assert.equal(status, 200, `control update failed for ${provider}`);
}

export async function resetSuppliers() {
  await supplier('A', '/_control/reset', { method: 'POST' });
  await supplier('B', '/_control/reset', { method: 'POST' });
}

export async function createOrder(sku, orderId) {
  const { status, body } = await api('/orders', {
    method: 'POST',
    body: orderId ? { sku, order_id: orderId } : { sku },
  });
  assert.equal(status, 201, `order creation failed: ${JSON.stringify(body)}`);
  return body;
}

export function paymentEvent(order, overrides = {}) {
  return {
    event_id: `evt_${randomUUID()}`,
    order_id: order.order_id ?? order,
    status: 'paid',
    amount: order.amount ?? overrides.amount,
    currency: order.currency ?? 'RUB',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export const sendWebhook = (payload) =>
  api('/webhooks/payment', { method: 'POST', body: payload });

export const getOrder = async (orderId) => (await api(`/orders/${orderId}`)).body;
export const auditOrder = async (orderId) => (await api(`/admin/orders/${orderId}/audit`)).body;
export const runRecovery = () => api('/admin/recovery/run', { method: 'POST' });
export const reconciliation = async () => (await api('/admin/reconciliation')).body;

export const issuedForOrder = async (provider, orderId) =>
  (await supplier(provider, `/_state/order/${orderId}`)).body.issued;

export const restock = (provider, sku, count) =>
  supplier(provider, '/_control/restock', { method: 'POST', body: { sku, count } });

export async function waitForStatus(orderId, statuses, timeoutMs = 25_000) {
  const wanted = Array.isArray(statuses) ? statuses : [statuses];
  const deadline = Date.now() + timeoutMs;
  let order = await getOrder(orderId);
  while (!wanted.includes(order.status)) {
    if (Date.now() > deadline) {
      const audit = await auditOrder(orderId);
      throw new Error(
        `timeout waiting for ${wanted.join('|')}, got ${order.status}\n${JSON.stringify(audit, null, 2)}`,
      );
    }
    await runRecovery();
    order = await getOrder(orderId);
  }
  return order;
}

export async function assertDeliveredExactlyOnce(orderId) {
  const order = await getOrder(orderId);
  assert.equal(order.status, 'delivered', 'order must be delivered');
  assert.ok(order.code, 'order must carry a code');

  const audit = await auditOrder(orderId);
  assert.equal(audit.counters.successful_attempts, 1, 'exactly one successful supplier attempt');
  assert.equal(audit.counters.delivery_issued_postings, 2, 'exactly one delivery ledger posting');
  assert.equal(audit.counters.payment_captured_postings, 2, 'exactly one payment ledger posting');

  const issuedA = await issuedForOrder('A', orderId);
  const issuedB = await issuedForOrder('B', orderId);
  const issued = [...issuedA, ...issuedB];
  assert.equal(issued.length, 1, `supplier issued ${issued.length} codes, expected 1`);
  assert.equal(issued[0].code, order.code, 'delivered code must match supplier record');

  return { order, audit, issued: issued[0] };
}
