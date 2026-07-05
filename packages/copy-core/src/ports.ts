import type { Address, ChainId, TradeIntent } from "@bot/domain";
import type { PublicClient } from "viem";
import type { ObservedSwap, TrackedWallet } from "./rules";

/**
 * The chain surface the watcher needs to read a leader's transfers. Structurally
 * satisfied by any viem `PublicClient`, including the failover client of
 * `@bot/rpc-manager`.
 */
export type WatcherClient = Pick<PublicClient, "getBlockNumber" | "getLogs">;

/** Persisted position amount for a token, read from the engine's book (M7). */
export interface PositionSource {
  amountOf(chainId: ChainId, token: Address, simulated: boolean): Promise<bigint>;
}

/**
 * What the policy asks the runner to do for one observed swap. Pure data — the
 * policy never touches the bus, the chain, or a key.
 */
export type CopyAction = { kind: "emit"; intent: TradeIntent } | { kind: "skip"; reason: string };

/** Everything the policy needs to decide, gathered by the runner before evaluate. */
export interface CopyContext {
  wallet: TrackedWallet;
  swap: ObservedSwap;
  /** Token base units we currently hold for `swap.token` (0 when flat). */
  heldAmount: bigint;
  now: number;
}

/**
 * The copy-sizing policy: pure and deterministic. Given a leader's swap and our
 * state, it returns the action to take — an intent to emit or a motivated skip.
 * Never mutates anything; the runner applies the result.
 */
export interface CopyPolicy {
  evaluate(ctx: CopyContext): CopyAction;
}

/**
 * Persistence for followed wallets, per-wallet block cursors, and the set of
 * already-copied swaps. The copied-set makes replays idempotent: an
 * at-least-once redelivery or a restart never mirrors the same swap twice.
 */
export interface CopyStore {
  upsertWallet(wallet: TrackedWallet): Promise<void>;
  getWallet(id: string): Promise<TrackedWallet | undefined>;
  /** Enabled wallets only — what the runner watches. */
  listActiveWallets(): Promise<TrackedWallet[]>;
  listWallets(): Promise<TrackedWallet[]>;

  /** Last block already scanned for a wallet. Restarts resume from here. */
  getCursor(walletId: string): Promise<bigint | undefined>;
  setCursor(walletId: string, lastScannedBlock: bigint): Promise<void>;

  hasCopied(walletId: string, txHash: string, logIndex: number): Promise<boolean>;
  markCopied(walletId: string, txHash: string, logIndex: number): Promise<void>;
}
