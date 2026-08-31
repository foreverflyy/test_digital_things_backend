import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDeliveredExactlyOnce,
  createOrder,
  paymentEvent,
  reconciliation,
  resetSuppliers,
  sendWebhook,
  setControl,
  waitForStatus,
} from './helpers.mjs';

before(resetSuppliers);
after(resetSuppliers);

test('при случайных отказах и таймаутах обоих поставщиков каждый заказ выдаётся ровно один раз', async () => {
  await setControl('A', { failure_rate: 0.4, timeout_rate: 0.3 });
  await setControl('B', { failure_rate: 0.3, timeout_rate: 0.2 });

  const skus = ['STEAM-TOPUP-500', 'KEY-CS2-PRIME', 'SUB-YT-3M', 'GIFT-XBOX-1500', 'KEY-GTA5'];
  const orders = await Promise.all(skus.map((sku) => createOrder(sku)));

  await Promise.all(orders.map((order) => sendWebhook(paymentEvent(order))));

  for (const order of orders) {
    await waitForStatus(order.order_id, 'delivered', 90_000);
    await assertDeliveredExactlyOnce(order.order_id);
  }

  const report = await reconciliation();
  for (const balance of report.ledger.balances) {
    assert.equal(balance.balance, 0, 'журнал сходится даже после хаоса');
  }
  assert.deepEqual(report.delivered_not_paid, [], 'нет выданных без оплаты');
});
