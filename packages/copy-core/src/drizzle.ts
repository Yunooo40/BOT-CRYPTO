import { eq, sql as rawSql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { toAddress, type Address, type ChainId } from "@bot/domain";
import { assertWithinWalletLimit } from "./limit";
import type { CopyStore } from "./ports";
import type { CopyMode, TrackedWallet } from "./rules";
import { copiedSwaps, copyCursors, trackedWallets } from "./schema";

/**
 * bigint-safe JSON: a wallet's sizing carries bigints (fixed/min/max amounts)
 * that JSON can't represent. We tag them `{"$bigint":"…"}` on write and revive
 * them on read, so the stored config round-trips losslessly.
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

/** The subset of a wallet stored in the JSONB `config` blob. */
interface WalletConfig {
  mode: CopyMode;
  sizeBps?: number;
  fixedAmountIn?: bigint;
  maxSlippageBps: number;
  allowTokens?: Address[];
  denyTokens?: Address[];
  minAmountIn?: bigint;
  maxAmountIn?: bigint;
}

type Row = typeof trackedWallets.$inferSelect;

function toConfig(wallet: TrackedWallet): WalletConfig {
  return {
    mode: wallet.mode,
    sizeBps: wallet.sizeBps,
    fixedAmountIn: wallet.fixedAmountIn,
    maxSlippageBps: wallet.maxSlippageBps,
    allowTokens: wallet.allowTokens,
    denyTokens: wallet.denyTokens,
    minAmountIn: wallet.minAmountIn,
    maxAmountIn: wallet.maxAmountIn,
  };
}

function toRow(wallet: TrackedWallet): Row {
  return {
    id: wallet.id,
    chainId: wallet.chainId,
    address: wallet.address,
    label: wallet.label ?? null,
    simulated: wallet.simulated,
    copySells: wallet.copySells,
    enabled: wallet.enabled,
    config: encodeBigints(toConfig(wallet)),
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  } as Row;
}

function toWallet(row: Row): TrackedWallet {
  const config = decodeBigints(row.config) as WalletConfig;
  return {
    id: row.id,
    chainId: row.chainId as ChainId,
    address: toAddress(row.address),
    label: row.label ?? undefined,
    mode: config.mode,
    sizeBps: config.sizeBps,
    fixedAmountIn: config.fixedAmountIn,
    maxSlippageBps: config.maxSlippageBps,
    allowTokens: config.allowTokens?.map((t) => toAddress(t)),
    denyTokens: config.denyTokens?.map((t) => toAddress(t)),
    minAmountIn: config.minAmountIn,
    maxAmountIn: config.maxAmountIn,
    copySells: row.copySells,
    simulated: row.simulated,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const copiedKey = (walletId: string, txHash: string, logIndex: number): string =>
  `${walletId}:${txHash}:${logIndex}`;

/** PostgreSQL-backed copy store via Drizzle. */
export class DrizzleCopyStore implements CopyStore {
  readonly #db: PostgresJsDatabase;

  constructor(db: PostgresJsDatabase) {
    this.#db = db;
  }

  static connect(databaseUrl: string): { store: DrizzleCopyStore; close: () => Promise<void> } {
    const sql = postgres(databaseUrl, { max: 5 });
    return {
      store: new DrizzleCopyStore(drizzle(sql)),
      close: async () => {
        await sql.end();
      },
    };
  }

  async upsertWallet(wallet: TrackedWallet): Promise<void> {
    if (wallet.enabled) {
      const existing = await this.#db
        .select({ id: trackedWallets.id })
        .from(trackedWallets)
        .where(eq(trackedWallets.enabled, true));
      assertWithinWalletLimit(
        existing.map((row) => row.id),
        wallet,
      );
    }
    const row = toRow(wallet);
    await this.#db
      .insert(trackedWallets)
      .values(row)
      .onConflictDoUpdate({
        target: trackedWallets.id,
        set: {
          label: row.label,
          simulated: row.simulated,
          copySells: row.copySells,
          enabled: row.enabled,
          config: row.config,
          updatedAt: row.updatedAt,
        },
      });
  }

  async getWallet(id: string): Promise<TrackedWallet | undefined> {
    const rows = await this.#db
      .select()
      .from(trackedWallets)
      .where(eq(trackedWallets.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toWallet(row);
  }

  async listActiveWallets(): Promise<TrackedWallet[]> {
    const rows = await this.#db
      .select()
      .from(trackedWallets)
      .where(eq(trackedWallets.enabled, true));
    return rows.map(toWallet);
  }

  async listWallets(): Promise<TrackedWallet[]> {
    const rows = await this.#db.select().from(trackedWallets);
    return rows.map(toWallet);
  }

  async getCursor(walletId: string): Promise<bigint | undefined> {
    const rows = await this.#db
      .select({ lastBlock: copyCursors.lastBlock })
      .from(copyCursors)
      .where(eq(copyCursors.walletId, walletId))
      .limit(1);
    return rows[0]?.lastBlock;
  }

  async setCursor(walletId: string, lastScannedBlock: bigint): Promise<void> {
    await this.#db
      .insert(copyCursors)
      .values({ walletId, lastBlock: lastScannedBlock })
      .onConflictDoUpdate({
        target: copyCursors.walletId,
        set: { lastBlock: lastScannedBlock, updatedAt: rawSql`now()` },
      });
  }

  async hasCopied(walletId: string, txHash: string, logIndex: number): Promise<boolean> {
    const rows = await this.#db
      .select({ key: copiedSwaps.key })
      .from(copiedSwaps)
      .where(eq(copiedSwaps.key, copiedKey(walletId, txHash, logIndex)))
      .limit(1);
    return rows.length > 0;
  }

  async markCopied(walletId: string, txHash: string, logIndex: number): Promise<void> {
    await this.#db
      .insert(copiedSwaps)
      .values({ key: copiedKey(walletId, txHash, logIndex) })
      .onConflictDoNothing();
  }
}
