import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleCopyStore } from "./drizzle";
import { wallet } from "./test-helpers";

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

describe.skipIf(!available)("DrizzleCopyStore (integration)", () => {
  const sql = postgres(DATABASE_URL, { max: 2 });
  let connection: ReturnType<typeof DrizzleCopyStore.connect>;

  beforeAll(async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../drizzle/0005_copy.sql", import.meta.url)),
      "utf8",
    );
    await sql.unsafe(migration);
    await sql`delete from tracked_wallets where id like ${"dz-%"}`;
    await sql`delete from copy_cursors where wallet_id like ${"dz-%"}`;
    await sql`delete from copied_swaps where key like ${"dz-%"}`;
    connection = DrizzleCopyStore.connect(DATABASE_URL);
  });

  afterAll(async () => {
    await sql`delete from tracked_wallets where id like ${"dz-%"}`;
    await sql`delete from copy_cursors where wallet_id like ${"dz-%"}`;
    await sql`delete from copied_swaps where key like ${"dz-%"}`;
    await connection.close();
    await sql.end({ timeout: 2 });
  });

  it("round-trips a wallet with bigint sizing losslessly", async () => {
    const w = wallet({
      id: "dz-1",
      mode: "fixed",
      fixedAmountIn: 10n ** 18n,
      minAmountIn: 5n,
      maxAmountIn: 10n ** 20n,
    });
    await connection.store.upsertWallet(w);
    const read = await connection.store.getWallet("dz-1");
    expect(read?.fixedAmountIn).toBe(10n ** 18n);
    expect(read?.maxAmountIn).toBe(10n ** 20n);
    expect(typeof read?.fixedAmountIn).toBe("bigint");
  });

  it("persists cursors and copied markers", async () => {
    await connection.store.setCursor("dz-cur", 123n);
    expect(await connection.store.getCursor("dz-cur")).toBe(123n);
    await connection.store.markCopied("dz", "0xfeed", 7);
    expect(await connection.store.hasCopied("dz", "0xfeed", 7)).toBe(true);
  });

  it("lists only enabled wallets", async () => {
    await connection.store.upsertWallet(wallet({ id: "dz-on", enabled: true }));
    await connection.store.upsertWallet(wallet({ id: "dz-off", enabled: false }));
    const ids = (await connection.store.listActiveWallets()).map((w) => w.id);
    expect(ids).toContain("dz-on");
    expect(ids).not.toContain("dz-off");
  });
});
