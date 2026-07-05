import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
}

/**
 * One pg pool for the app. Construction is lazy — no connection is opened
 * until the first query — so booting with an unreachable database fails on
 * the first use (bootstrap admin upsert), loudly, not at import time.
 */
export function createDatabase(connectionString: string): DatabaseHandle {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}
