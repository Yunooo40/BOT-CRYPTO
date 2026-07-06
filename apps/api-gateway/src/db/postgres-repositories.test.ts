import { fileURLToPath } from "node:url";
import { toAddress } from "@bot/domain";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateApiKey } from "../auth/api-key";
import { DuplicateEmailError } from "../errors";
import type { TradeHistoryRecord } from "../portfolio/trade-history";
import { createDatabase, type DatabaseHandle } from "./client";
import {
  DrizzlePortfolioPositionsRepository,
  DrizzleTradeHistoryRepository,
  PostgresApiKeyRepository,
  PostgresUserRepository,
} from "./postgres-repositories";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://botcrypto:botcrypto@localhost:5432/botcrypto";
// When DATABASE_URL is set explicitly (CI), the integration suite must run —
// an unreachable Postgres is a failure, not a silent skip.
const DATABASE_REQUIRED = process.env.DATABASE_URL !== undefined;

async function postgresReachable(): Promise<boolean> {
  const probe = createDatabase(DATABASE_URL);
  try {
    await probe.pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.pool.end().catch(() => undefined);
  }
}

const available = await postgresReachable();

it.runIf(DATABASE_REQUIRED)("postgres is reachable when DATABASE_URL is set", () => {
  expect(available).toBe(true);
});

describe.runIf(available)("Postgres repositories (integration)", () => {
  let handle: DatabaseHandle;
  let users: PostgresUserRepository;
  let apiKeys: PostgresApiKeyRepository;

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL);
    await migrate(handle.db, {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });
    users = new PostgresUserRepository(handle.db);
    apiKeys = new PostgresApiKeyRepository(handle.db);
  });

  beforeEach(async () => {
    await handle.pool.query("DELETE FROM api_keys; DELETE FROM users;");
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  const newUser = { email: "it@test.dev", passwordHash: "scrypt$…", role: "admin" as const };

  it("creates and finds users", async () => {
    const created = await users.create(newUser);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBeInstanceOf(Date);
    await expect(users.findByEmail("it@test.dev")).resolves.toMatchObject({ id: created.id });
    await expect(users.findById(created.id)).resolves.toMatchObject({ email: "it@test.dev" });
    await expect(users.findByEmail("ghost@test.dev")).resolves.toBeUndefined();
  });

  it("refuses duplicate emails with the domain error", async () => {
    await users.create(newUser);
    await expect(users.create(newUser)).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it("updates the password hash", async () => {
    const created = await users.create(newUser);
    await users.updatePasswordHash(created.id, "scrypt$new");
    await expect(users.findById(created.id)).resolves.toMatchObject({
      passwordHash: "scrypt$new",
    });
  });

  it("round-trips API keys with scopes, expiry and usage stamps", async () => {
    const owner = await users.create(newUser);
    const generated = generateApiKey();
    const expiresAt = new Date(Date.now() + 60_000);
    const created = await apiKeys.create({
      userId: owner.id,
      name: "bot",
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      scopes: ["read", "trade"],
      expiresAt,
    });
    expect(created.revokedAt).toBeNull();

    const found = await apiKeys.findByHash(generated.keyHash);
    expect(found).toMatchObject({ id: created.id, scopes: ["read", "trade"] });
    expect(found?.expiresAt?.getTime()).toBe(expiresAt.getTime());

    const at = new Date();
    await apiKeys.touchLastUsed(created.id, at);
    const touched = await apiKeys.findByHash(generated.keyHash);
    expect(touched?.lastUsedAt?.getTime()).toBe(at.getTime());

    await expect(apiKeys.listByUser(owner.id)).resolves.toHaveLength(1);
  });

  it("revokes exactly once, only for the owner", async () => {
    const owner = await users.create(newUser);
    const other = await users.create({ ...newUser, email: "other@test.dev" });
    const generated = generateApiKey();
    const created = await apiKeys.create({
      userId: owner.id,
      name: "bot",
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      scopes: ["read"],
      expiresAt: null,
    });

    await expect(apiKeys.revoke(created.id, other.id)).resolves.toBe(false);
    await expect(apiKeys.revoke(created.id, owner.id)).resolves.toBe(true);
    await expect(apiKeys.revoke(created.id, owner.id)).resolves.toBe(false);
    const revoked = await apiKeys.findByHash(generated.keyHash);
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
  });

  it("cascades key deletion when the owner is deleted", async () => {
    const owner = await users.create(newUser);
    const generated = generateApiKey();
    await apiKeys.create({
      userId: owner.id,
      name: "bot",
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      scopes: ["read"],
      expiresAt: null,
    });
    await handle.pool.query("DELETE FROM users WHERE id = $1", [owner.id]);
    await expect(apiKeys.findByHash(generated.keyHash)).resolves.toBeUndefined();
  });
});

const PEPE = toAddress("0x1111111111111111111111111111111111111111");

describe.runIf(available)("Portfolio repositories (integration)", () => {
  let handle: DatabaseHandle;
  let history: DrizzleTradeHistoryRepository;
  let positions: DrizzlePortfolioPositionsRepository;

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL);
    await migrate(handle.db, {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });
    history = new DrizzleTradeHistoryRepository(handle.db);
    positions = new DrizzlePortfolioPositionsRepository(handle.db);
  });

  beforeEach(async () => {
    await handle.pool.query("DELETE FROM trade_history; DELETE FROM portfolio_positions;");
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  function record(id: string, occurredAt: number): TradeHistoryRecord {
    return {
      id,
      chainId: 8453,
      side: "buy",
      token: PEPE,
      amountIn: { raw: 1_000_000_000_000_000_000n, decimals: 18 },
      amountOut: { raw: 1_000_000n, decimals: 18 },
      txHash: `0x${id
        .repeat(64)
        .slice(0, 64)
        .replace(/[^0-9a-f]/gi, "0")}`,
      simulated: false,
      occurredAt,
    };
  }

  it("appends idempotently and paginates newest-first", async () => {
    await history.append(record("t1", 1_000));
    await history.append(record("t2", 2_000));
    await history.append(record("t1", 1_000)); // redelivery, no-op

    const all = await history.listAll();
    expect(all.map((r) => r.id)).toEqual(["t1", "t2"]);

    const page1 = await history.list({ limit: 1 });
    expect(page1.items.map((r) => r.id)).toEqual(["t2"]);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await history.list({ limit: 1, cursor: page1.nextCursor });
    expect(page2.items.map((r) => r.id)).toEqual(["t1"]);
    expect(page2.nextCursor).toBeUndefined();
  });

  it("round-trips a position through get/upsert/remove", async () => {
    const base = {
      id: "8453:0x1111111111111111111111111111111111111111:live",
      chainId: 8453 as const,
      token: PEPE,
      simulated: false,
      amount: 1_000_000n,
      costBasis: 1_000_000_000_000_000_000n,
      realizedPnl: 0n,
      openedAt: 1_000,
      updatedAt: 1_000,
    };
    await positions.upsert(base);
    await expect(positions.get(8453, PEPE, false)).resolves.toMatchObject({
      amount: 1_000_000n,
      costBasis: 1_000_000_000_000_000_000n,
    });

    await positions.upsert({ ...base, amount: 500_000n, updatedAt: 2_000 });
    await expect(positions.list()).resolves.toEqual([
      expect.objectContaining({ amount: 500_000n }),
    ]);

    await positions.remove(base.id);
    await expect(positions.get(8453, PEPE, false)).resolves.toBeUndefined();
  });
});
