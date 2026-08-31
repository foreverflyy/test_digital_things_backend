import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const envFile = resolve(process.cwd(), process.env.ENV_FILE ?? '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const booleanFromEnv = (fallback: boolean) =>
  z.preprocess(
    (value) =>
      value === undefined || value === ''
        ? fallback
        : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase()),
    z.boolean(),
  );

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('postgres://shop:shop@localhost:5440/shop'),
  LOG_LEVEL: z.string().default('info'),

  SUPPLIER_A_URL: z.string().default('http://localhost:4001'),
  SUPPLIER_B_URL: z.string().default('http://localhost:4002'),
  SUPPLIER_TIMEOUT_MS: z.coerce.number().default(2000),
  SUPPLIER_RETRIES: z.coerce.number().default(2),
  SUPPLIER_BACKOFF_BASE_MS: z.coerce.number().default(200),
  DELIVERY_MAX_RECONCILE: z.coerce.number().default(5),
  DELIVERY_MAX_ATTEMPTS: z.coerce.number().default(6),

  WORKER_ENABLED: booleanFromEnv(true),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().default(250),
  WORKER_CONCURRENCY: z.coerce.number().default(4),
  STUCK_ORDER_AGE_MS: z.coerce.number().default(5000),

  SUPPLIER_ID: z.string().default('A'),
  SUPPLIER_PORT: z.coerce.number().default(4001),
});

export type AppConfig = z.infer<typeof schema>;

export const appConfig: AppConfig = schema.parse(process.env);

export const CONFIG = Symbol('APP_CONFIG');
