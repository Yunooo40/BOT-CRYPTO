import type { Address, Dex } from "@bot/domain";
import type { PublicClient } from "viem";

/**
 * The chain surface the scanner needs. Structurally satisfied by any viem
 * `PublicClient`, including the failover client of `@bot/rpc-manager`.
 */
export type ScannerClient = Pick<PublicClient, "getBlockNumber" | "getLogs" | "readContract">;

/**
 * Persistent per-venue block cursor: the last block already scanned. Restarts
 * resume from here — no gap, no full rescan.
 */
export interface ScanCursorStore {
  get(dex: Dex): Promise<bigint | undefined>;
  set(dex: Dex, lastScannedBlock: bigint): Promise<void>;
}

/**
 * Pools already published. Publishing is at-least-once (a crash between
 * publish and `add` may replay one pool — bus consumers are idempotent by
 * contract), but reorgs and range overlaps never duplicate.
 */
export interface SeenPoolStore {
  has(pool: Address): Promise<boolean>;
  add(pool: Address): Promise<void>;
}
