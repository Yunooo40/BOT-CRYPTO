import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { toAddress } from "@bot/domain";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleWalletRepository } from "./drizzle";
import type { WalletRecord } from "./repository";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://botcrypto:botcrypto@localhost:5432/botcrypto";
// When DATABASE_URL is set explicitly (CI), the integration suite must run — an
// unreachable Postgres is a failure, not a silent skip.
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

// Guard: in CI (DATABASE_URL set) this asserts the suite below actually ran
// instead of being skipped, so a green pipeline proves the Drizzle repo works.
it.runIf(DATABASE_REQUIRED)(
  "Postgres is reachable when DATABASE_URL is configured (CI guard)",
  () => {
    expect(available).toBe(true);
  },
);

describe.skipIf(!available)("DrizzleWalletRepository (integration)", () => {
  const sql = postgres(DATABASE_URL, { max: 2 });
  const insertedIds: string[] = [];
  let connection: ReturnType<typeof DrizzleWalletRepository.connect>;

  beforeAll(async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../drizzle/0001_wallets.sql", import.meta.url)),
      "utf8",
    );
    await sql.unsafe(migration);
    connection = DrizzleWalletRepository.connect(DATABASE_URL);
  });

  afterAll(async () => {
    for (const id of insertedIds) {
      await sql`delete from wallets where id = ${id}`;
    }
    await connection.close();
    await sql.end({ timeout: 2 });
  });

  function makeRecord(): WalletRecord {
    const record: WalletRecord = {
      id: randomUUID(),
      tenantId: null,
      label: "integration",
      address: toAddress(`0x${randomBytes(20).toString("hex")}`),
      encryptedKey: "v1:c2FsdA==:aXZpdml2aXZpdg==:Y2lwaGVydGV4dA==:dGFnMTIzNDU2Nzg5MDEy",
      createdAt: new Date(),
    };
    insertedIds.push(record.id);
    return record;
  }

  it("inserts and reads back a record, by id and by address", async () => {
    const record = makeRecord();
    await connection.repository.insert(record);
    const byId = await connection.repository.findById(record.id);
    expect(byId).toMatchObject({
      id: record.id,
      label: record.label,
      address: record.address,
      encryptedKey: record.encryptedKey,
    });
    const byAddress = await connection.repository.findByAddress(record.address);
    expect(byAddress?.id).toBe(record.id);
  });

  it("returns undefined for unknown ids", async () => {
    await expect(connection.repository.findById(randomUUID())).resolves.toBeUndefined();
  });

  it("rejects a duplicate address (unique index)", async () => {
    const record = makeRecord();
    await connection.repository.insert(record);
    const duplicate = { ...makeRecord(), address: record.address };
    await expect(connection.repository.insert(duplicate)).rejects.toThrow();
  });

  it("lists oldest first", async () => {
    const older = { ...makeRecord(), createdAt: new Date(Date.now() - 60_000) };
    const newer = makeRecord();
    await connection.repository.insert(newer);
    await connection.repository.insert(older);
    const listed = await connection.repository.list();
    const ours = listed.filter((r) => r.id === older.id || r.id === newer.id);
    expect(ours.map((r) => r.id)).toEqual([older.id, newer.id]);
  });
});
