import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDeliveredExactlyOnce,
  auditOrder,
  createOrder,
  paymentEvent,
  resetSuppliers,
  sendWebhook,
  setControl,
  supplier,
  waitForStatus,
} from './helpers.mjs';

before(resetSuppliers);
after(resetSuppliers);

test('таймаут поставщика, который успел выдать код, не приводит ко второй выдаче', async () => {
  await setControl('A', { issue_then_hang: true });
  await setControl('B', { hard_down: true });

  const order = await createOrder('KEY-EFT');
  await sendWebhook(paymentEvent(order));

  const stuck = await waitForStatus(order.order_id, ['delivering', 'delivered'], 30_000);
  assert.ok(stuck, 'заказ не должен упасть после таймаута');

  const afterTimeout = await auditOrder(order.order_id);
  const firstAttempt = afterTimeout.attempts[0];
  assert.equal(firstAttempt.provider, 'A', 'первая попытка идёт к поставщику A');
  assert.ok(
    ['unknown', 'ok'].includes(firstAttempt.status),
    `таймаут переводит попытку в unknown, а не в failed (получено ${firstAttempt.status})`,
  );

  const issuedByA = await supplier('A', `/_state/issued/${firstAttempt.request_id}`);
  assert.ok(issuedByA.body.issued, 'поставщик A действительно выдал код до таймаута');

  const delivered = await waitForStatus(order.order_id, 'delivered', 30_000);
  const result = await assertDeliveredExactlyOnce(order.order_id);

  assert.equal(
    delivered.code,
    issuedByA.body.issued.code,
    'после реконсиляции выдан тот же код, что поставщик записал до таймаута',
  );
  assert.equal(
    result.issued.request_id,
    firstAttempt.request_id,
    'повтор ушёл с тем же request_id',
  );
});
