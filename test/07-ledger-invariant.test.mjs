import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOrder,
  paymentEvent,
  reconciliation,
  resetSuppliers,
  runRecovery,
  sendWebhook,
  waitForStatus,
} from './helpers.mjs';

before(resetSuppliers);

test('журнал денежных движений сходится и совпадает со сверкой по статусам', async () => {
  const orders = await Promise.all([
    createOrder('STEAM-TOPUP-500'),
    createOrder('STEAM-TOPUP-1000'),
    createOrder('GIFT-XBOX-1500'),
  ]);

  await Promise.all(orders.map((order) => sendWebhook(paymentEvent(order))));
  for (const order of orders) await waitForStatus(order.order_id, 'delivered');

  const failed = await createOrder('SUB-YT-3M');
  await sendWebhook(paymentEvent(failed, { status: 'failed' }));

  await runRecovery();
  const report = await reconciliation();

  for (const balance of report.ledger.balances) {
    assert.equal(balance.balance, 0, `баланс по ${balance.currency_code} должен быть нулевым`);
  }
  assert.deepEqual(report.ledger.unbalanced_transactions, [], 'нет несбалансированных проводок');
  assert.deepEqual(report.ledger.mixed_currency_transactions, [], 'проводки не смешивают валюты');
  assert.deepEqual(report.delivered_not_paid, [], 'нет выданных без оплаты');
  assert.equal(
    report.ledger.deferred_revenue_minor,
    report.ledger.paid_not_delivered_minor,
    'остаток deferred_revenue равен сумме «оплачен, но не выдан»',
  );
  assert.equal(report.healthy, true, 'сверка считает систему консистентной');
});
