import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfig, CONFIG } from '../config/app-config';
import { LoggerService } from '../logging/logger.service';
import { RecoveryService } from '../reconciliation/recovery.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { Check, ScenarioName, ScenarioResult, SelfTestReport } from './selftest.types';

interface OrderView {
  order_id: string;
  status: string;
  code: string | null;
  amount: number;
}

@Injectable()
export class SelfTestService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly recovery: RecoveryService,
    private readonly reconciliation: ReconciliationService,
    private readonly logger: LoggerService,
  ) {}

  private get baseUrl(): string {
    return `http://127.0.0.1:${this.config.PORT}`;
  }

  private supplierUrl(provider: 'A' | 'B'): string {
    return provider === 'A' ? this.config.SUPPLIER_A_URL : this.config.SUPPLIER_B_URL;
  }

  async run(only?: ScenarioName): Promise<SelfTestReport> {
    const startedAt = Date.now();
    const runners: Array<[ScenarioName, () => Promise<ScenarioResult>]> = [
      ['race_webhooks', () => this.raceWebhooks()],
      ['duplicate_event', () => this.duplicateEvent()],
      ['webhook_before_order', () => this.webhookBeforeOrder()],
      ['timeout_trap', () => this.timeoutTrap()],
      ['fallback_ab', () => this.fallbackAb()],
      ['out_of_stock_recovery', () => this.outOfStockRecovery()],
      ['ledger_invariant', () => this.ledgerInvariant()],
    ];

    const selected = only ? runners.filter(([name]) => name === only) : runners;
    const scenarios: ScenarioResult[] = [];

    for (const [, runner] of selected) {
      await this.resetSuppliers();
      scenarios.push(await runner());
    }
    await this.resetSuppliers();

    const passed = scenarios.filter((scenario) => scenario.passed).length;
    const report: SelfTestReport = {
      started_at: new Date(startedAt).toISOString(),
      duration_ms: Date.now() - startedAt,
      passed,
      failed: scenarios.length - passed,
      total: scenarios.length,
      all_passed: passed === scenarios.length,
      scenarios,
    };

    this.logger.info('selftest.finished', {
      passed: report.passed,
      failed: report.failed,
      duration_ms: report.duration_ms,
    });
    return report;
  }

  private async scenario(
    name: ScenarioName,
    title: string,
    criterion: string,
    body: (add: (check: Check) => void) => Promise<string | null>,
  ): Promise<ScenarioResult> {
    const startedAt = Date.now();
    const checks: Check[] = [];
    const add = (check: Check) => checks.push(check);

    try {
      const orderId = await body(add);
      return {
        name,
        title,
        criterion,
        passed: checks.every((check) => check.informational || check.passed),
        duration_ms: Date.now() - startedAt,
        order_id: orderId,
        checks,
      };
    } catch (error) {
      return {
        name,
        title,
        criterion,
        passed: false,
        duration_ms: Date.now() - startedAt,
        order_id: null,
        checks,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private check(description: string, expected: unknown, actual: unknown): Check {
    return {
      description,
      expected: String(expected),
      actual: String(actual),
      passed: String(expected) === String(actual),
    };
  }

  private info(description: string, value: unknown): Check {
    return {
      description,
      expected: '—',
      actual: String(value),
      passed: true,
      informational: true,
    };
  }

  private async raceWebhooks(): Promise<ScenarioResult> {
    return this.scenario(
      'race_webhooks',
      '50 параллельных вебхуков по одному заказу',
      'Критерий 1: ровно один факт выдачи, без потерь и дублей',
      async (add) => {
        const order = await this.createOrder('KEY-CS2-PRIME');
        const results = await Promise.all(
          Array.from({ length: 50 }, () => this.sendWebhook(order, 'paid')),
        );

        const applied = results.filter((r) => r.result === 'applied').length;
        const noop = results.filter((r) => r.result === 'ignored_not_pending').length;
        add(this.check('событий перевело заказ в paid', 1, applied));
        add(this.check('остальные обработаны как no-op', 49, noop));

        const final = await this.waitForStatus(order.order_id, ['delivered']);
        add(this.check('итоговый статус заказа', 'delivered', final.status));
        await this.assertSingleDelivery(order.order_id, add);
        return order.order_id;
      },
    );
  }

  private async duplicateEvent(): Promise<ScenarioResult> {
    return this.scenario(
      'duplicate_event',
      'Повтор одного и того же event_id',
      'Критерий 2: повторный вебхук ничего не меняет',
      async (add) => {
        const order = await this.createOrder('KEY-GTA5');
        const eventId = `evt_${randomUUID()}`;
        const results = await Promise.all(
          Array.from({ length: 20 }, () => this.sendWebhook(order, 'paid', { eventId })),
        );

        add(this.check('применено событий', 1, results.filter((r) => r.result === 'applied').length));
        add(
          this.check('отбито как дубликат', 19, results.filter((r) => r.result === 'duplicate').length),
        );

        const final = await this.waitForStatus(order.order_id, ['delivered']);
        const repeat = await this.sendWebhook(order, 'paid', { eventId });
        add(this.check('повтор после выдачи', 'duplicate', repeat.result));

        const after = await this.getOrder(order.order_id);
        add(this.check('код не изменился', final.code ?? '', after.code ?? ''));
        return order.order_id;
      },
    );
  }

  private async webhookBeforeOrder(): Promise<ScenarioResult> {
    return this.scenario(
      'webhook_before_order',
      'Вебхук пришёл раньше заказа и не по порядку',
      'Критерий 3: обработано корректно, без потери события',
      async (add) => {
        const orderId = `ord_selftest_${randomUUID().slice(0, 8)}`;
        const early = await this.postJson('/webhooks/payment', {
          event_id: `evt_${randomUUID()}`,
          order_id: orderId,
          status: 'paid',
          amount: 1290,
          currency: 'RUB',
          created_at: new Date().toISOString(),
        });
        add(this.check('ответ на вебхук без заказа', 'order_missing', early.body.result));

        await this.postJson('/orders', { sku: 'KEY-CS2-PRIME', order_id: orderId });
        const final = await this.waitForStatus(orderId, ['delivered']);
        add(this.check('после создания заказа', 'delivered', final.status));

        const late = await this.postJson('/webhooks/payment', {
          event_id: `evt_${randomUUID()}`,
          order_id: orderId,
          status: 'failed',
          amount: 1290,
          currency: 'RUB',
          created_at: new Date(Date.now() - 600_000).toISOString(),
        });
        add(this.check('опоздавший failed', 'ignored_stale', late.body.result));

        const after = await this.getOrder(orderId);
        add(this.check('статус не откатился', 'delivered', after.status));
        return orderId;
      },
    );
  }

  private async timeoutTrap(): Promise<ScenarioResult> {
    return this.scenario(
      'timeout_trap',
      'Поставщик выдал код и завис',
      'Критерий 4: повтор с тем же request_id не создаёт вторую выдачу',
      async (add) => {
        await this.setControl('A', { issue_then_hang: true });
        await this.setControl('B', { hard_down: true });

        const order = await this.createOrder('KEY-EFT');
        await this.sendWebhook(order, 'paid');

        const final = await this.waitForStatus(order.order_id, ['delivered'], 40_000);
        add(this.check('заказ доведён', 'delivered', final.status));

        const audit = await this.getJson(`/admin/orders/${order.order_id}/audit`);
        const first = audit.attempts[0];
        add(this.check('первая попытка ушла к поставщику', 'A', first?.provider));

        const issued = await this.getJson(
          `/_state/issued/${first.request_id}`,
          this.supplierUrl('A'),
        );
        add(this.check('поставщик записал код до зависания', true, Boolean(issued.issued)));

        if (first.status === 'ok') {
          add(
            this.check(
              'повтор с тем же request_id вернул тот же код',
              issued.issued?.code ?? '',
              first.code ?? '',
            ),
          );
        } else {
          add(
            this.check(
              'код первой попытки отброшен как уже использованный',
              'code_already_used',
              first.error_reason ?? '',
            ),
          );
          add(this.info('код, записанный поставщиком до зависания', issued.issued?.code ?? ''));
        }

        await this.assertSingleDelivery(order.order_id, add);
        return order.order_id;
      },
    );
  }

  private async fallbackAb(): Promise<ScenarioResult> {
    return this.scenario(
      'fallback_ab',
      'Поставщик A недоступен',
      'Критерий 5: fallback на B, товар выдан ровно один раз',
      async (add) => {
        await this.setControl('A', { hard_down: true });

        const order = await this.createOrder('GIFT-PSN-1000');
        await this.sendWebhook(order, 'paid');
        const final = await this.waitForStatus(order.order_id, ['delivered'], 40_000);
        add(this.check('заказ выдан', 'delivered', final.status));

        const audit = await this.getJson(`/admin/orders/${order.order_id}/audit`);
        const toA = audit.attempts.filter((a: { provider: string }) => a.provider === 'A');
        const okB = audit.attempts.filter(
          (a: { provider: string; status: string }) => a.provider === 'B' && a.status === 'ok',
        );
        add(this.check('к A обращались и получили отказ', true, toA.length > 0));
        add(this.check('успешных выдач у B', 1, okB.length));

        const issuedByA = await this.getJson(
          `/_state/order/${order.order_id}`,
          this.supplierUrl('A'),
        );
        add(this.check('A не выдавал код', 0, issuedByA.issued.length));
        await this.assertSingleDelivery(order.order_id, add);
        return order.order_id;
      },
    );
  }

  private async outOfStockRecovery(): Promise<ScenarioResult> {
    return this.scenario(
      'out_of_stock_recovery',
      'Пустой остаток и восстановление после пополнения',
      'Критерий 6: восстановимое состояние, без падения',
      async (add) => {
        await this.setControl('A', { force_out_of_stock: true });
        await this.setControl('B', { force_out_of_stock: true });

        const order = await this.createOrder('SUB-SPOTIFY-1M');
        const webhook = await this.sendWebhook(order, 'paid');
        add(this.check('вебхук обработан без ошибки', 'applied', webhook.result));

        const stalled = await this.waitForStatus(order.order_id, ['out_of_stock'], 30_000);
        add(this.check('состояние восстановимое', 'out_of_stock', stalled.status));

        const report = await this.getJson('/admin/reconciliation');
        const seen = report.paid_not_delivered.some(
          (row: { order_id: string }) => row.order_id === order.order_id,
        );
        add(this.check('виден в сверке «оплачен, но не выдан»', true, seen));

        await this.resetSuppliers();
        await this.postJson('/_control/restock', { sku: 'SUB-SPOTIFY-1M', count: 5 }, this.supplierUrl('B'));

        const final = await this.waitForStatus(order.order_id, ['delivered'], 40_000);
        add(this.check('после пополнения заказ доведён', 'delivered', final.status));
        await this.assertSingleDelivery(order.order_id, add);
        return order.order_id;
      },
    );
  }

  private async ledgerInvariant(): Promise<ScenarioResult> {
    return this.scenario(
      'ledger_invariant',
      'Журнал денежных движений сходится',
      'Оценивается: надёжность денежных операций и консистентность',
      async (add) => {
        await this.recovery.runAll();
        const report = await this.reconciliation.report();

        for (const balance of report.ledger.balances) {
          add(this.check(`баланс по ${balance.currency_code}`, 0, balance.balance));
        }
        add(
          this.check(
            'несбалансированных проводок',
            0,
            report.ledger.unbalanced_transactions.length,
          ),
        );
        add(this.check('проводок со смешанной валютой', 0, report.ledger.mixed_currency_transactions.length));
        add(this.check('выдано без оплаты', 0, report.delivered_not_paid.length));
        add(
          this.check(
            'deferred_revenue равен сумме «оплачен, но не выдан»',
            report.ledger.paid_not_delivered_minor,
            report.ledger.deferred_revenue_minor,
          ),
        );
        return null;
      },
    );
  }

  private async assertSingleDelivery(orderId: string, add: (check: Check) => void): Promise<void> {
    const audit = await this.getJson(`/admin/orders/${orderId}/audit`);
    const successful = audit.attempts.filter((a: { status: string }) => a.status === 'ok');

    add(this.check('успешных попыток выдачи', 1, audit.counters.successful_attempts));
    add(this.check('проводок о выдаче (2 строки = 1 проводка)', 2, audit.counters.delivery_issued_postings));
    add(this.check('проводок об оплате', 2, audit.counters.payment_captured_postings));

    const order = await this.getOrder(orderId);
    const winner = successful[0];
    const record = winner
      ? await this.getJson(`/_state/issued/${winner.request_id}`, this.supplierUrl(winner.provider))
      : { issued: null };

    add(
      this.check(
        'код заказа получен по request_id успешной попытки',
        record.issued?.code ?? '',
        order.code ?? '',
      ),
    );

    const fromA = await this.getJson(`/_state/order/${orderId}`, this.supplierUrl('A'));
    const fromB = await this.getJson(`/_state/order/${orderId}`, this.supplierUrl('B'));
    const discarded = [...fromA.issued, ...fromB.issued].length - 1;
    add(
      this.info(
        'кодов отброшено как уже использованные (следствие перезапуска заглушки)',
        discarded,
      ),
    );
  }

  private async createOrder(sku: string): Promise<OrderView> {
    const response = await this.postJson('/orders', { sku });
    return response.body as OrderView;
  }

  private async sendWebhook(
    order: OrderView,
    status: 'paid' | 'failed',
    options: { eventId?: string } = {},
  ): Promise<{ result: string }> {
    const response = await this.postJson('/webhooks/payment', {
      event_id: options.eventId ?? `evt_${randomUUID()}`,
      order_id: order.order_id,
      status,
      amount: order.amount,
      currency: 'RUB',
      created_at: new Date().toISOString(),
    });
    return response.body as { result: string };
  }

  private async getOrder(orderId: string): Promise<OrderView> {
    return this.getJson(`/orders/${orderId}`);
  }

  private async waitForStatus(
    orderId: string,
    statuses: string[],
    timeoutMs = 30_000,
  ): Promise<OrderView> {
    const deadline = Date.now() + timeoutMs;
    let order = await this.getOrder(orderId);
    while (!statuses.includes(order.status)) {
      if (Date.now() > deadline) return order;
      await this.recovery.runAll();
      order = await this.getOrder(orderId);
    }
    return order;
  }

  private async setControl(provider: 'A' | 'B', patch: Record<string, unknown>): Promise<void> {
    await this.postJson('/_control', patch, this.supplierUrl(provider));
  }

  private async resetSuppliers(): Promise<void> {
    await this.postJson('/_control/reset', {}, this.supplierUrl('A'));
    await this.postJson('/_control/reset', {}, this.supplierUrl('B'));
  }

  private async postJson(path: string, body: unknown, base = this.baseUrl) {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  private async getJson(path: string, base = this.baseUrl) {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}
