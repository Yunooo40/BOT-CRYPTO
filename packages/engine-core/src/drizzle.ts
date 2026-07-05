import { and, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { toAddress, type Address, type ChainId } from "@bot/domain";
import type { PositionRecord, PositionStore } from "./ports";
import { positions } from "./schema";

type Row = typeof positions.$inferSelect;

function toRecord(row: Row): PositionRecord {
  return {
    id: row.id,
    chainId: row.chainId as ChainId,
    token: toAddress(row.token),
    simulated: row.simulated,
    amount: row.amount,
    costBasis: row.costBasis,
    realizedPnl: row.realizedPnl,
    openedAt: row.openedAt,
    updatedAt: row.updatedAt,
  };
}

/** PostgreSQL-backed position book via Drizzle. */
export class DrizzlePositionStore implements PositionStore {
  readonly #db: PostgresJsDatabase;

  constructor(db: PostgresJsDatabase) {
    this.#db = db;
  }

  static connect(databaseUrl: string): { store: DrizzlePositionStore; close: () => Promise<void> } {
    const sql = postgres(databaseUrl, { max: 5 });
    return {
      store: new DrizzlePositionStore(drizzle(sql)),
      close: async () => {
        await sql.end();
      },
    };
  }

  async get(
    chainId: ChainId,
    token: Address,
    simulated: boolean,
  ): Promise<PositionRecord | undefined> {
    const rows = await this.#db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.chainId, chainId),
          eq(positions.token, token),
          eq(positions.simulated, simulated),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toRecord(row);
  }

  async upsert(record: PositionRecord): Promise<void> {
    await this.#db
      .insert(positions)
      .values(record)
      .onConflictDoUpdate({
        target: positions.id,
        set: {
          amount: record.amount,
          costBasis: record.costBasis,
          realizedPnl: record.realizedPnl,
          updatedAt: record.updatedAt,
        },
      });
  }

  async remove(id: string): Promise<void> {
    await this.#db.delete(positions).where(eq(positions.id, id));
  }

  async list(): Promise<PositionRecord[]> {
    const rows = await this.#db.select().from(positions);
    return rows.map(toRecord);
  }
}
