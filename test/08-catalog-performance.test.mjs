import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from './helpers.mjs';

test('витрина остатков остаётся быстрой на каталоге в тысячи SKU', async () => {
  const total = (await api('/products?limit=1')).body;
  assert.ok(total.items.length > 0, 'каталог не пустой');

  const durations = [];
  for (let i = 0; i < 30; i += 1) {
    const startedAt = performance.now();
    const response = await api('/products?type=key&limit=24&in_stock=true');
    durations.push(performance.now() - startedAt);
    assert.equal(response.status, 200);
  }

  durations.sort((a, b) => a - b);
  const p95 = durations[Math.floor(durations.length * 0.95)];
  console.log(`витрина: median ${durations[15].toFixed(1)}ms, p95 ${p95.toFixed(1)}ms`);
  assert.ok(p95 < 150, `p95 витрины ${p95.toFixed(1)}ms должен быть ниже 150ms`);

  const { body } = await api('/products/explain?type=key');
  const plan = body.plan.join('\n');
  console.log(plan);
  assert.ok(
    plan.includes('Index Only Scan') || plan.includes('Index Scan'),
    'горячий запрос витрины должен идти по индексу, а не Seq Scan',
  );
});

test('keyset-пагинация не деградирует с глубиной', async () => {
  let cursor = null;
  let pages = 0;
  const durations = [];

  do {
    const startedAt = performance.now();
    const { body } = await api(`/products?limit=50${cursor ? `&cursor=${cursor}` : ''}`);
    durations.push(performance.now() - startedAt);
    cursor = body.next_cursor;
    pages += 1;
  } while (cursor && pages < 20);

  const first = durations[0];
  const last = durations[durations.length - 1];
  console.log(`страница 1: ${first.toFixed(1)}ms, страница ${pages}: ${last.toFixed(1)}ms`);
  assert.ok(pages > 5, 'должно быть достаточно страниц для проверки глубины');
  assert.ok(last < first * 5 + 50, 'глубокая страница не должна быть кратно дороже первой');
});
