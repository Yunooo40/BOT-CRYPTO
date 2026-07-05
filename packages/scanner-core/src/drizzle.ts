import { eq, sql as rawSql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Address, Dex } from "@bot/domain";
import type { ScanCursorStore, SeenPoolStore } from "./ports";
import { scanCursors, seenPools } from "./schema";

/** PostgreSQL-backed scan state: survives restarts — no gap, no full rescan. */
export class DrizzleScanState implements ScanCursorStore, SeenPoolStore {
  readonly #db: PostgresJsDatabase;

  constructor(db: PostgresJsDatabase) {
    this.#db = db;
  }

  /** Convenience: own connection from a URL. Call `close()` on shutdown. */
  static connect(databaseUrl: string): { state: DrizzleScanState; close: () => Promise<void> } {
    const sql = postgres(databaseUrl, { max: 5 });
    return {
      state: new DrizzleScanState(drizzle(sql)),
      close: async () => {
        await sql.end();
      },
    };
  }

  async get(dex: Dex): Promise<bigint | undefined> {
    const rows = await this.#db
      .select({ lastBlock: scanCursors.lastBlock })
      .from(scanCursors)
      .where(eq(scanCursors.dex, dex))
      .limit(1);
    return rows[0]?.lastBlock;
  }

  async set(dex: Dex, lastScannedBlock: bigint): Promise<void> {
    await this.#db
      .insert(scanCursors)
      .values({ dex, lastBlock: lastScannedBlock })
      .onConflictDoUpdate({
        target: scanCursors.dex,
        set: { lastBlock: lastScannedBlock, updatedAt: rawSql`now()` },
      });
  }

  async has(pool: Address): Promise<boolean> {
    const rows = await this.#db
      .select({ address: seenPools.address })
      .from(seenPools)
      .where(eq(seenPools.address, pool))
      .limit(1);
    return rows.length > 0;
  }

  async add(pool: Address): Promise<void> {
    await this.#db.insert(seenPools).values({ address: pool }).onConflictDoNothing();
  }
}
