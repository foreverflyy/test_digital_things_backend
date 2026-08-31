import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDeliveredExactlyOnce,
  createOrder,
  paymentEvent,
  resetSuppliers,
  sendWebhook,
  waitForStatus,
} from './helpers.mjs';

before(resetSuppliers);

test('50 параллельных вебхуков по одному заказу дают ровно одну выдачу', async () => {
  const order = await createOrder('KEY-CS2-PRIME');

  const responses = await Promise.all(
    Array.from({ length: 50 }, () => sendWebhook(paymentEvent(order))),
  );

  assert.ok(
    responses.every((response) => response.status === 200),
    'все вебхуки должны получить 200',
  );

  const applied = responses.filter((response) => response.body.result === 'applied');
  const ignored = responses.filter((response) => response.body.result === 'ignored_not_pending');

  assert.equal(applied.length, 1, 'ровно одно событие переводит заказ в paid');
  assert.equal(ignored.length, 49, 'остальные 49 обработаны как no-op, без потерь');

  await waitForStatus(order.order_id, 'delivered');
  await assertDeliveredExactlyOnce(order.order_id);
});
