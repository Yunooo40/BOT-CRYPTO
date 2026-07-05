-- M9 — copy trading state. Keep in sync with src/schema.ts.
CREATE TABLE IF NOT EXISTS tracked_wallets (
  id text PRIMARY KEY,
  chain_id integer NOT NULL,
  address text NOT NULL,
  label text,
  simulated boolean NOT NULL,
  copy_sells boolean NOT NULL,
  enabled boolean NOT NULL,
  config jsonb NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS tracked_wallets_enabled_idx ON tracked_wallets (enabled);

CREATE TABLE IF NOT EXISTS copy_cursors (
  wallet_id text PRIMARY KEY,
  last_block bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS copied_swaps (
  key text PRIMARY KEY,
  copied_at timestamptz NOT NULL DEFAULT now()
);
