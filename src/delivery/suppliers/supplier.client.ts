import { LoggerService } from '../../logging/logger.service';

export interface IssueRequest {
  requestId: string;
  sku: string;
  orderId: string;
}

export type SupplierOutcome =
  | { kind: 'ok'; code: string; httpStatus: number }
  | { kind: 'out_of_stock'; httpStatus: number }
  | { kind: 'error'; httpStatus: number | null; reason: string }
  | { kind: 'timeout' };

export interface SupplierClientOptions {
  timeoutMs: number;
  retries: number;
  backoffBaseMs: number;
}

export class SupplierClient {
  constructor(
    readonly id: string,
    private readonly baseUrl: string,
    private readonly options: SupplierClientOptions,
    private readonly logger: LoggerService,
  ) {}

  async issue(request: IssueRequest): Promise<SupplierOutcome> {
    let lastError: SupplierOutcome = { kind: 'error', httpStatus: null, reason: 'no_attempt' };

    for (let attempt = 0; attempt <= this.options.retries; attempt += 1) {
      const startedAt = Date.now();
      const outcome = await this.call(request);
      this.logger.info('supplier.call', {
        provider: this.id,
        request_id: request.requestId,
        order_id: request.orderId,
        sku: request.sku,
        transport_attempt: attempt + 1,
        outcome: outcome.kind,
        http_status: 'httpStatus' in outcome ? outcome.httpStatus : null,
        duration_ms: Date.now() - startedAt,
      });

      if (outcome.kind === 'ok' || outcome.kind === 'timeout') return outcome;
      if (outcome.kind === 'out_of_stock') return outcome;

      lastError = outcome;
      const retriable = outcome.httpStatus === null || outcome.httpStatus >= 500;
      if (!retriable || attempt === this.options.retries) return outcome;

      const backoff =
        this.options.backoffBaseMs * 2 ** attempt + Math.floor(Math.random() * this.options.backoffBaseMs);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }

    return lastError;
  }

  private async call(request: IssueRequest): Promise<SupplierOutcome> {
    try {
      const response = await fetch(`${this.baseUrl}/issue`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-trace-id': LoggerService.currentTraceId() ?? '',
        },
        body: JSON.stringify({
          request_id: request.requestId,
          sku: request.sku,
          order_id: request.orderId,
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });

      const body = (await response.json().catch(() => ({}))) as {
        status?: string;
        code?: string;
        reason?: string;
      };

      if (response.ok && body.status === 'ok' && body.code) {
        return { kind: 'ok', code: body.code, httpStatus: response.status };
      }
      if (body.reason === 'out_of_stock') {
        return { kind: 'out_of_stock', httpStatus: response.status };
      }
      return {
        kind: 'error',
        httpStatus: response.status,
        reason: body.reason ?? `http_${response.status}`,
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'timeout' };
      return {
        kind: 'error',
        httpStatus: null,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async stock(): Promise<Array<{ sku: string; available: number }>> {
    try {
      const response = await fetch(`${this.baseUrl}/stock`, {
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      if (!response.ok) return [];
      const body = (await response.json()) as { stock?: Array<{ sku: string; available: number }> };
      return body.stock ?? [];
    } catch {
      return [];
    }
  }
}

export const SUPPLIERS = Symbol('SUPPLIERS');
