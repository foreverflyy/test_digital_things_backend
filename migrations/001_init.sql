CREATE TABLE currencies (
  code        char(3) PRIMARY KEY,
  exponent    smallint NOT NULL CHECK (exponent BETWEEN 0 AND 8),
  symbol      text NOT NULL
);

CREATE TABLE products (
  sku             text PRIMARY KEY,
  name            text NOT NULL,
  type            text NOT NULL CHECK (type IN ('topup','key','subscription','giftcard')),
  price_minor     bigint NOT NULL CHECK (price_minor > 0),
  currency_code   char(3) NOT NULL REFERENCES currencies(code),
  image           text,
  is_active       boolean NOT NULL DEFAULT true,
  popularity      integer NOT NULL DEFAULT 0,
  stock_count     integer NOT NULL DEFAULT 0,
  stock_synced_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX products_showcase_idx
  ON products (type, popularity DESC, sku DESC)
  INCLUDE (name, price_minor, currency_code, stock_count)
  WHERE is_active;

CREATE TABLE orders (
  id                    text PRIMARY KEY,
  sku                   text NOT NULL REFERENCES products(sku),
  price_minor           bigint NOT NULL,
  currency_code         char(3) NOT NULL REFERENCES currencies(code),
  status                text NOT NULL CHECK (status IN (
                          'created','paid','delivering','delivered',
                          'payment_failed','out_of_stock','delivery_failed')),
  delivered_code        text,
  delivered_at          timestamptz,
  delivery_attempt_id   bigint,
  delivery_attempt_no   integer NOT NULL DEFAULT 0,
  last_payment_event_at timestamptz,
  paid_at               timestamptz,
  idempotency_key       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX orders_delivered_code_uniq
  ON orders (delivered_code) WHERE delivered_code IS NOT NULL;

CREATE UNIQUE INDEX orders_idempotency_key_uniq
  ON orders (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX orders_recovery_idx
  ON orders (status, updated_at)
  WHERE status IN ('paid','delivering','out_of_stock','delivery_failed');

CREATE TABLE payment_events (
  event_id      text PRIMARY KEY,
  order_id      text NOT NULL,
  status        text NOT NULL CHECK (status IN ('paid','failed')),
  amount_minor  bigint NOT NULL,
  currency_code char(3) NOT NULL,
  occurred_at   timestamptz NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  applied_at    timestamptz,
  apply_result  text,
  payload       jsonb NOT NULL
);

CREATE INDEX payment_events_pending_idx ON payment_events (order_id) WHERE applied_at IS NULL;
CREATE INDEX payment_events_order_idx ON payment_events (order_id);

CREATE TABLE delivery_attempts (
  id              bigserial PRIMARY KEY,
  order_id        text NOT NULL REFERENCES orders(id),
  provider        text NOT NULL,
  request_id      text NOT NULL UNIQUE,
  attempt_no      integer NOT NULL,
  status          text NOT NULL CHECK (status IN ('in_flight','ok','failed','unknown')),
  code            text,
  http_status     integer,
  error_reason    text,
  reconcile_count integer NOT NULL DEFAULT 0,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

CREATE UNIQUE INDEX delivery_attempts_single_success_idx
  ON delivery_attempts (order_id) WHERE status = 'ok';

CREATE UNIQUE INDEX delivery_attempts_code_uniq
  ON delivery_attempts (code) WHERE code IS NOT NULL AND status = 'ok';

CREATE INDEX delivery_attempts_open_idx
  ON delivery_attempts (status, started_at) WHERE status IN ('in_flight','unknown');

CREATE TABLE ledger_entries (
  id            bigserial PRIMARY KEY,
  txn_id        uuid NOT NULL,
  order_id      text NOT NULL,
  account       text NOT NULL CHECK (account IN (
                  'gateway_receivable','deferred_revenue','revenue')),
  direction     text NOT NULL CHECK (direction IN ('debit','credit')),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  currency_code char(3) NOT NULL REFERENCES currencies(code),
  kind          text NOT NULL CHECK (kind IN ('payment_captured','delivery_issued')),
  ref           text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ledger_entries_idempotent_idx
  ON ledger_entries (order_id, kind, ref, account, direction);

CREATE INDEX ledger_entries_order_idx ON ledger_entries (order_id);

CREATE TABLE supplier_stock (
  provider   text NOT NULL,
  sku        text NOT NULL,
  available  integer NOT NULL DEFAULT 0,
  synced_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, sku)
);

CREATE TABLE jobs (
  id            bigserial PRIMARY KEY,
  name          text NOT NULL,
  dedupe_key    text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','done','failed')),
  run_at        timestamptz NOT NULL DEFAULT now(),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 25,
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  trace_id      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX jobs_active_dedupe_idx
  ON jobs (name, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('pending','running');

CREATE INDEX jobs_claim_idx ON jobs (run_at, id) WHERE status = 'pending';
CREATE INDEX jobs_stale_idx ON jobs (locked_at) WHERE status = 'running';

CREATE TABLE schedules (
  name         text PRIMARY KEY,
  interval_ms  integer NOT NULL,
  next_run_at  timestamptz NOT NULL DEFAULT now(),
  last_run_at  timestamptz
);
