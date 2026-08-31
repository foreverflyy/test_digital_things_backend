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

export interface LogRecord {
  time: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  event: string;
  trace_id?: string;
  [key: string]: unknown;
}

const RING_SIZE = 2000;
const ring: LogRecord[] = [];

function remember(record: LogRecord): void {
  ring.push(record);
  if (ring.length > RING_SIZE) ring.shift();
}

@Injectable({ scope: Scope.DEFAULT })
export class LoggerService {
  static runWithTrace<T>(traceId: string, fn: () => T): T {
    return traceStorage.run({ traceId }, fn);
  }

  static currentTraceId(): string | undefined {
    return traceStorage.getStore()?.traceId;
  }

  static recent(filter: { orderId?: string; event?: string; limit: number }): LogRecord[] {
    const matched = ring.filter((record) => {
      if (filter.orderId && record.order_id !== filter.orderId) return false;
      if (filter.event && !record.event.includes(filter.event)) return false;
      return true;
    });
    return matched.slice(-filter.limit).reverse();
  }

  private enrich(fields: LogFields): LogFields {
    const traceId = LoggerService.currentTraceId();
    return traceId ? { trace_id: traceId, ...fields } : fields;
  }

  private write(level: LogRecord['level'], event: string, fields: LogFields): void {
    const payload = this.enrich({ event, ...fields });
    root[level](payload);
    remember({ time: new Date().toISOString(), level, ...payload } as LogRecord);
  }

  info(event: string, fields: LogFields = {}): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.write('error', event, fields);
  }

  debug(event: string, fields: LogFields = {}): void {
    this.write('debug', event, fields);
  }
}
