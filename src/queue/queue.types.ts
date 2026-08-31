export interface Job {
  id: number;
  name: string;
  dedupe_key: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  trace_id: string | null;
}

export type JobHandler = (job: Job) => Promise<void>;

export interface EnqueueOptions {
  dedupeKey?: string | null;
  delayMs?: number;
  maxAttempts?: number;
}

export const JOB_NAMES = {
  deliverOrder: 'deliver-order',
  applyOrphanEvents: 'apply-orphan-events',
  reconcileUnknownAttempts: 'reconcile-unknown-attempts',
  resumeStuckOrders: 'resume-stuck-orders',
  syncSupplierStock: 'sync-supplier-stock',
} as const;
