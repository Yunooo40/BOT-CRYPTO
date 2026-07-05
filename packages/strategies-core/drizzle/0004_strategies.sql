-- M8 — strategy rules. Keep in sync with src/schema.ts.
CREATE TABLE IF NOT EXISTS strategies (
  id text PRIMARY KEY,
  type text NOT NULL,
  chain_id integer NOT NULL,
  token text NOT NULL,
  wallet_id text NOT NULL,
  simulated boolean NOT NULL,
  status text NOT NULL,
  pool jsonb NOT NULL,
  params jsonb NOT NULL,
  state jsonb NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS strategies_status_idx ON strategies (status);
