import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDeliveredExactlyOnce,
  auditOrder,
  createOrder,
  paymentEvent,
  resetSuppliers,
  sendWebhook,
  waitForStatus,
} from './helpers.mjs';

before(resetSuppliers);

test('повторный вебхук с тем же event_id ничего не меняет', async () => {
  const order = await createOrder('KEY-GTA5');
  const event = paymentEvent(order);

  const responses = await Promise.all(Array.from({ length: 20 }, () => sendWebhook(event)));

  const applied = responses.filter((response) => response.body.result === 'applied');
  const duplicates = responses.filter((response) => response.body.result === 'duplicate');

  assert.equal(applied.length, 1, 'событие применяется один раз');
  assert.equal(duplicates.length, 19, 'остальные 19 отбиты как дубликаты');

  await waitForStatus(order.order_id, 'delivered');
  const delivered = await assertDeliveredExactlyOnce(order.order_id);

  const repeat = await sendWebhook(event);
  assert.equal(repeat.body.result, 'duplicate');

  const audit = await auditOrder(order.order_id);
  assert.equal(audit.counters.events, 1, 'в журнале ровно одно событие');
  assert.equal(audit.order.delivered_code, delivered.order.code, 'код не изменился');
});
