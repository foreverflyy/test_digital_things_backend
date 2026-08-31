import { Injectable, Scope } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import { appConfig } from '../config/app-config';

const traceStorage = new AsyncLocalStorage<{ traceId: string }>();

const root = pino({
  level: appConfig.LOG_LEVEL,
  base: { service: process.env.SERVICE_NAME ?? 'shop-core' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type LogFields = Record<string, unknown>;

@Injectable({ scope: Scope.DEFAULT })
export class LoggerService {
  static runWithTrace<T>(traceId: string, fn: () => T): T {
    return traceStorage.run({ traceId }, fn);
  }

  static currentTraceId(): string | undefined {
    return traceStorage.getStore()?.traceId;
  }

  private enrich(fields: LogFields): LogFields {
    const traceId = LoggerService.currentTraceId();
    return traceId ? { trace_id: traceId, ...fields } : fields;
  }

  info(event: string, fields: LogFields = {}): void {
    root.info(this.enrich({ event, ...fields }));
  }

  warn(event: string, fields: LogFields = {}): void {
    root.warn(this.enrich({ event, ...fields }));
  }

  error(event: string, fields: LogFields = {}): void {
    root.error(this.enrich({ event, ...fields }));
  }

  debug(event: string, fields: LogFields = {}): void {
    root.debug(this.enrich({ event, ...fields }));
  }
}
