import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { toAddress, type ChainId, type Pool } from "@bot/domain";
import type { StrategyStore } from "./ports";
import type { StrategyParams, StrategyRule, StrategyState } from "./rules";
import { strategies } from "./schema";

/**
 * bigint-safe JSON: strategy params/state carry bigints (prices, amounts) that
 * JSON can't represent. We tag them `{"$bigint":"…"}` on write and revive them
 * on read, so the stored shape round-trips losslessly.
 */
function encodeBigints(value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (Array.isArray(value)) return value.map(encodeBigints);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeBigints(v)]));
  }
  return value;
}

function decodeBigints(value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    if ("$bigint" in value && typeof (value as { $bigint: unknown }).$bigint === "string") {
      return BigInt((value as { $bigint: string }).$bigint);
    }
    if (Array.isArray(value)) return value.map(decodeBigints);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeBigints(v)]));
  }
  return value;
}

type Row = typeof strategies.$inferSelect;

function toRule(row: Row): StrategyRule {
  return {
    id: row.id,
    type: row.type as StrategyRule["type"],
    chainId: row.chainId as ChainId,
    token: toAddress(row.token),
    walletId: row.walletId,
    simulated: row.simulated,
    status: row.status as StrategyRule["status"],
    pool: decodeBigints(row.pool) as Pool,
    params: decodeBigints(row.params) as StrategyParams,
    state: decodeBigints(row.state) as StrategyState,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRow(rule: StrategyRule): Row {
  return {
    id: rule.id,
    type: rule.type,
    chainId: rule.chainId,
    token: rule.token,
    walletId: rule.walletId,
    simulated: rule.simulated,
    status: rule.status,
    pool: encodeBigints(rule.pool),
    params: encodeBigints(rule.params),
    state: encodeBigints(rule.state),
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  } as Row;
}

/** PostgreSQL-backed strategy store via Drizzle. */
export class DrizzleStrategyStore implements StrategyStore {
  readonly #db: PostgresJsDatabase;

  constructor(db: PostgresJsDatabase) {
    this.#db = db;
  }

  static connect(databaseUrl: string): { store: DrizzleStrategyStore; close: () => Promise<void> } {
    const sql = postgres(databaseUrl, { max: 5 });
    return {
      store: new DrizzleStrategyStore(drizzle(sql)),
      close: async () => {
        await sql.end();
      },
    };
  }

  async upsert(rule: StrategyRule): Promise<void> {
    const row = toRow(rule);
    await this.#db
      .insert(strategies)
      .values(row)
      .onConflictDoUpdate({
        target: strategies.id,
        set: { status: row.status, params: row.params, state: row.state, updatedAt: row.updatedAt },
      });
  }

  async get(id: string): Promise<StrategyRule | undefined> {
    const rows = await this.#db.select().from(strategies).where(eq(strategies.id, id)).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toRule(row);
  }

  async listActive(): Promise<StrategyRule[]> {
    const rows = await this.#db.select().from(strategies).where(eq(strategies.status, "active"));
    return rows.map(toRule);
  }

  async list(): Promise<StrategyRule[]> {
    const rows = await this.#db.select().from(strategies);
    return rows.map(toRule);
  }
}
