import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDeliveredExactlyOnce,
  createOrder,
  getOrder,
  paymentEvent,
  reconciliation,
  resetSuppliers,
  restock,
  sendWebhook,
  setControl,
  waitForStatus,
} from './helpers.mjs';

before(resetSuppliers);
after(resetSuppliers);

test('пустой остаток даёт восстановимое состояние, а после пополнения заказ доводится', async () => {
  await setControl('A', { force_out_of_stock: true });
  await setControl('B', { force_out_of_stock: true });

  const order = await createOrder('SUB-SPOTIFY-1M');
  const webhook = await sendWebhook(paymentEvent(order));
  assert.equal(webhook.status, 200, 'вебхук обработан без падения');

  const stalled = await waitForStatus(order.order_id, 'out_of_stock', 20_000);
  assert.equal(stalled.status, 'out_of_stock', 'состояние восстановимое, а не аварийное');

  const report = await reconciliation();
  assert.ok(
    report.paid_not_delivered.some((row) => row.order_id === order.order_id),
    'заказ виден в сверке «оплачен, но не выдан»',
  );

  await setControl('A', {});
  await setControl('B', {});
  await restock('B', 'SUB-SPOTIFY-1M', 5);

  await waitForStatus(order.order_id, 'delivered', 30_000);
  await assertDeliveredExactlyOnce(order.order_id);

  const final = await getOrder(order.order_id);
  assert.ok(final.code, 'после пополнения остатка код выдан');
});
