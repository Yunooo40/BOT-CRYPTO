-- M4 — wallets table. Keep in sync with src/schema.ts.
CREATE TABLE IF NOT EXISTS wallets (
  id text PRIMARY KEY,
  tenant_id text,
  label text NOT NULL,
  address text NOT NULL,
  encrypted_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wallets_address_idx ON wallets (address);
