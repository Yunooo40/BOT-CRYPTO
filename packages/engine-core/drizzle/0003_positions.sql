-- M7 — positions book. Keep in sync with src/schema.ts.
CREATE TABLE IF NOT EXISTS positions (
  id text PRIMARY KEY,
  chain_id integer NOT NULL,
  token text NOT NULL,
  simulated boolean NOT NULL,
  amount bigint NOT NULL,
  cost_basis bigint NOT NULL,
  realized_pnl bigint NOT NULL,
  opened_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
