import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { toAddress } from "@bot/domain";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleScanState } from "./drizzle";

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

describe.skipIf(!available)("DrizzleScanState (integration)", () => {
  const sql = postgres(DATABASE_URL, { max: 2 });
  const pools = [
    toAddress(`0x${randomBytes(20).toString("hex")}`),
    toAddress(`0x${randomBytes(20).toString("hex")}`),
  ];
  let connection: ReturnType<typeof DrizzleScanState.connect>;

  beforeAll(async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../drizzle/0002_scanner.sql", import.meta.url)),
      "utf8",
    );
    await sql.unsafe(migration);
    connection = DrizzleScanState.connect(DATABASE_URL);
  });

  afterAll(async () => {
    await sql`delete from scan_cursors where dex = ${"uniswap-v2"}`;
    for (const pool of pools) {
      await sql`delete from seen_pools where address = ${pool}`;
    }
    await connection.close();
    await sql.end({ timeout: 2 });
  });

  it("persists and upserts the block cursor", async () => {
    await expect(connection.state.get("uniswap-v2")).resolves.toBeUndefined();
    await connection.state.set("uniswap-v2", 123n);
    await expect(connection.state.get("uniswap-v2")).resolves.toBe(123n);
    await connection.state.set("uniswap-v2", 456n);
    await expect(connection.state.get("uniswap-v2")).resolves.toBe(456n);
  });

  it("remembers seen pools idempotently", async () => {
    const [first, second] = pools;
    if (first === undefined || second === undefined) {
      throw new Error("fixtures missing");
    }
    await expect(connection.state.has(first)).resolves.toBe(false);
    await connection.state.add(first);
    await connection.state.add(first); // duplicate add is a no-op
    await expect(connection.state.has(first)).resolves.toBe(true);
    await expect(connection.state.has(second)).resolves.toBe(false);
  });
});
