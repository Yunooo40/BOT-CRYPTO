import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleStrategyStore } from "./drizzle";
import { P, rule } from "./test-helpers";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://botcrypto:botcrypto@localhost:5432/botcrypto";
const DATABASE_REQUIRED = process.env.DATABASE_URL !== undefined;

async function postgresReachable(): Promise<boolean> {
  const probe = postgres(DATABASE_URL, { max: 1, connect_timeout: 2 });
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.end({ timeout: 1 });
  }
}

const available = await postgresReachable();

it.runIf(DATABASE_REQUIRED)(
  "Postgres is reachable when DATABASE_URL is configured (CI guard)",
  () => {
    expect(available).toBe(true);
  },
);

describe.skipIf(!available)("DrizzleStrategyStore (integration)", () => {
  const sql = postgres(DATABASE_URL, { max: 2 });
  let connection: ReturnType<typeof DrizzleStrategyStore.connect>;

  beforeAll(async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../drizzle/0004_strategies.sql", import.meta.url)),
      "utf8",
    );
    await sql.unsafe(migration);
    await sql`delete from strategies where wallet_id = ${"wallet-1"}`;
    connection = DrizzleStrategyStore.connect(DATABASE_URL);
  });

  afterAll(async () => {
    await sql`delete from strategies where wallet_id = ${"wallet-1"}`;
    await connection.close();
    await sql.end({ timeout: 2 });
  });

  it("round-trips a rule with bigint params/state losslessly", async () => {
    const r = rule(
      "trailing-stop",
      { kind: "trailing-stop", trailingBps: 1_000, sellFractionBps: 10_000, maxSlippageBps: 100 },
      { id: "dz-1", state: { highWaterMark: P(2) } },
    );
    await connection.store.upsert(r);
    const read = await connection.store.get("dz-1");
    expect(read?.state.highWaterMark).toBe(P(2));
    expect(read?.pool.address).toBe(r.pool.address);
    expect(typeof read?.state.highWaterMark).toBe("bigint");
  });

  it("lists only active rules", async () => {
    await connection.store.upsert(
      rule(
        "dca",
        { kind: "dca", amountPerBuy: 5n, intervalMs: 1, totalBuys: 1, maxSlippageBps: 1 },
        { id: "dz-active", status: "active" },
      ),
    );
    await connection.store.upsert(
      rule(
        "dca",
        { kind: "dca", amountPerBuy: 5n, intervalMs: 1, totalBuys: 1, maxSlippageBps: 1 },
        { id: "dz-done", status: "done" },
      ),
    );
    const active = await connection.store.listActive();
    const ids = active.map((r) => r.id);
    expect(ids).toContain("dz-active");
    expect(ids).not.toContain("dz-done");
  });
});
