import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzlePositionStore } from "./drizzle";
import { applyTrade } from "./positions";
import { MEME } from "./test-helpers";
import { tokenAmount, type Trade } from "@bot/domain";

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

function buy(amountIn: bigint, amountOut: bigint): Trade {
  return {
    id: `${MEME}:sim`,
    chainId: 8453,
    side: "buy",
    token: MEME,
    amountIn: tokenAmount(amountIn, 0),
    amountOut: tokenAmount(amountOut, 0),
    txHash: `0x${"2".repeat(64)}`,
    simulated: true,
  };
}

describe.skipIf(!available)("DrizzlePositionStore (integration)", () => {
  const sql = postgres(DATABASE_URL, { max: 2 });
  let connection: ReturnType<typeof DrizzlePositionStore.connect>;

  beforeAll(async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../drizzle/0003_positions.sql", import.meta.url)),
      "utf8",
    );
    await sql.unsafe(migration);
    await sql`delete from positions where token = ${MEME}`;
    connection = DrizzlePositionStore.connect(DATABASE_URL);
  });

  afterAll(async () => {
    await sql`delete from positions where token = ${MEME}`;
    await connection.close();
    await sql.end({ timeout: 2 });
  });

  it("persists a position folded from trades and reads it back", async () => {
    const now = () => 42;
    await applyTrade(connection.store, buy(1_000n, 1_000n), now);
    const position = await connection.store.get(8453, MEME, true);
    expect(position).toMatchObject({ amount: 1_000n, costBasis: 1_000n, realizedPnl: 0n });
  });

  it("upserts on a second buy (averaged basis) and removes on full close", async () => {
    const now = () => 43;
    await applyTrade(connection.store, buy(500n, 1_000n), now); // amount 2000, basis 1500
    const merged = await connection.store.get(8453, MEME, true);
    expect(merged).toMatchObject({ amount: 2_000n, costBasis: 1_500n });

    const sell: Trade = {
      ...buy(2_000n, 3_000n),
      side: "sell",
    };
    await applyTrade(connection.store, sell, now);
    await expect(connection.store.get(8453, MEME, true)).resolves.toBeUndefined();
  });
});
