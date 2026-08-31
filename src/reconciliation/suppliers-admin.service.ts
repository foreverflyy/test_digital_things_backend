import { Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/app-config';

export type ProviderId = 'A' | 'B';

@Injectable()
export class SuppliersAdminService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  private urlOf(provider: ProviderId): string {
    return provider === 'A' ? this.config.SUPPLIER_A_URL : this.config.SUPPLIER_B_URL;
  }

  private async call(provider: ProviderId, path: string, body?: unknown) {
    const response = await fetch(`${this.urlOf(provider)}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async overview() {
    const providers = await Promise.all(
      (['A', 'B'] as ProviderId[]).map(async (provider) => {
        try {
          const [control, stock] = await Promise.all([
            this.call(provider, '/_control'),
            this.call(provider, '/stock'),
          ]);
          return {
            provider,
            url: this.urlOf(provider),
            reachable: true,
            control,
            stock: stock.stock,
          };
        } catch (error) {
          return {
            provider,
            url: this.urlOf(provider),
            reachable: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    return { providers };
  }

  setControl(provider: ProviderId, patch: Record<string, unknown>) {
    return this.call(provider, '/_control', patch);
  }

  resetControl(provider: ProviderId) {
    return this.call(provider, '/_control/reset', {});
  }

  restock(provider: ProviderId, sku: string, count: number) {
    return this.call(provider, '/_control/restock', { sku, count });
  }

  issuedForOrder(provider: ProviderId, orderId: string) {
    return this.call(provider, `/_state/order/${orderId}`);
  }
}
