import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDeliveredExactlyOnce,
  auditOrder,
  createOrder,
  issuedForOrder,
  paymentEvent,
  resetSuppliers,
  sendWebhook,
  setControl,
  waitForStatus,
} from './helpers.mjs';

before(resetSuppliers);
after(resetSuppliers);

test('поставщик A недоступен — fallback на B, товар выдан ровно один раз', async () => {
  await setControl('A', { hard_down: true });
  await setControl('B', {});

  const order = await createOrder('GIFT-PSN-1000');
  await sendWebhook(paymentEvent(order));

  await waitForStatus(order.order_id, 'delivered');
  const result = await assertDeliveredExactlyOnce(order.order_id);

  const audit = await auditOrder(order.order_id);
  const providerA = audit.attempts.filter((attempt) => attempt.provider === 'A');
  const providerB = audit.attempts.filter((attempt) => attempt.provider === 'B');

  assert.ok(providerA.length >= 1, 'к A обращались');
  assert.ok(
    providerA.every((attempt) => attempt.status === 'failed'),
    'все попытки к A закончились явным отказом',
  );
  assert.equal(providerB.filter((attempt) => attempt.status === 'ok').length, 1, 'B выдал ровно раз');
  assert.equal(result.issued.provider, 'B', 'код пришёл от резервного поставщика');

  const issuedByA = await issuedForOrder('A', order.order_id);
  assert.equal(issuedByA.length, 0, 'A не выдавал код по этому заказу');
});
