-- M5 — scanner state. Keep in sync with src/schema.ts.
CREATE TABLE IF NOT EXISTS scan_cursors (
  dex text PRIMARY KEY,
  last_block bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seen_pools (
  address text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);
