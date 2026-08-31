import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  assertDeliveredExactlyOnce,
  auditOrder,
  createOrder,
  getOrder,
  paymentEvent,
  resetSuppliers,
  sendWebhook,
  waitForStatus,
} from './helpers.mjs';

before(resetSuppliers);

test('вебхук, пришедший раньше заказа, применяется после его создания', async () => {
  const orderId = `ord_${randomUUID().slice(0, 12)}`;

  const early = await sendWebhook({
    event_id: `evt_${randomUUID()}`,
    order_id: orderId,
    status: 'paid',
    amount: 1290,
    currency: 'RUB',
    created_at: new Date().toISOString(),
  });

  assert.equal(early.status, 200, 'вебхук без заказа не должен получать ошибку');
  assert.equal(early.body.result, 'order_missing');

  await createOrder('KEY-CS2-PRIME', orderId);
  await waitForStatus(orderId, 'delivered');
  await assertDeliveredExactlyOnce(orderId);

  const audit = await auditOrder(orderId);
  assert.equal(audit.events[0].apply_result, 'applied', 'осиротевшее событие применено');
});

test('опоздавший failed не отменяет успешную оплату', async () => {
  const order = await createOrder('SUB-DISCORD-1M');
  const paidAt = new Date();

  await sendWebhook(paymentEvent(order, { created_at: paidAt.toISOString() }));
  await waitForStatus(order.order_id, 'delivered');

  const stale = await sendWebhook(
    paymentEvent(order, {
      status: 'failed',
      created_at: new Date(paidAt.getTime() - 60_000).toISOString(),
    }),
  );
  assert.equal(stale.body.result, 'ignored_stale', 'событие из прошлого игнорируется');

  const late = await sendWebhook(
    paymentEvent(order, {
      status: 'failed',
      created_at: new Date(paidAt.getTime() + 60_000).toISOString(),
    }),
  );
  assert.equal(late.body.result, 'ignored_not_pending', 'заказ уже не в created — no-op');

  const final = await getOrder(order.order_id);
  assert.equal(final.status, 'delivered', 'финальный статус не откатывается');
  await assertDeliveredExactlyOnce(order.order_id);
});

test('оплата, пришедшая после отказа, не теряется', async () => {
  const order = await createOrder('GIFT-ROBLOX-800');
  const failedAt = new Date();

  const failed = await sendWebhook(
    paymentEvent(order, { status: 'failed', created_at: failedAt.toISOString() }),
  );
  assert.equal(failed.body.result, 'applied');
  assert.equal((await getOrder(order.order_id)).status, 'payment_failed');

  const paid = await sendWebhook(
    paymentEvent(order, { created_at: new Date(failedAt.getTime() + 1000).toISOString() }),
  );
  assert.equal(paid.body.result, 'applied', 'более поздняя оплата перекрывает ранний отказ');

  await waitForStatus(order.order_id, 'delivered');
  await assertDeliveredExactlyOnce(order.order_id);
});
