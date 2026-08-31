export interface Check {
  description: string;
  expected: string;
  actual: string;
  passed: boolean;
  informational?: boolean;
}

export interface ScenarioResult {
  name: string;
  title: string;
  criterion: string;
  passed: boolean;
  duration_ms: number;
  order_id: string | null;
  checks: Check[];
  error?: string;
}

export interface SelfTestReport {
  started_at: string;
  duration_ms: number;
  passed: number;
  failed: number;
  total: number;
  all_passed: boolean;
  scenarios: ScenarioResult[];
}

export const SCENARIO_NAMES = [
  'race_webhooks',
  'duplicate_event',
  'webhook_before_order',
  'timeout_trap',
  'fallback_ab',
  'out_of_stock_recovery',
  'ledger_invariant',
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];
