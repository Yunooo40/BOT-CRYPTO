import type { Address, ChainId, Pool, RiskFactor } from "@bot/domain";
import type { PublicClient } from "viem";

/**
 * Chain surface the detectors read from. Structurally satisfied by any viem
 * `PublicClient` — the failover client of `@bot/rpc-manager` in practice.
 */
export type ShieldClient = Pick<PublicClient, "readContract" | "getCode" | "getStorageAt">;

/** Everything a detector needs about the token under analysis. */
export interface DetectorContext {
  chainId: ChainId;
  /** The token being assessed. */
  token: Address;
  /** The reference token it trades against (WETH by default). */
  quoteToken: Address;
  /** The pool it was detected in, when known. */
  pool?: Pool;
  /** Deployed bytecode of the token, fetched once and shared across detectors. */
  bytecode: `0x${string}`;
  client: ShieldClient;
}

/**
 * One risk detector. `detect` must never throw or hang forever: the analyzer
 * wraps it in a timeout, and any failure becomes an "indeterminate" factor —
 * a moderate score with an honest detail — rather than a crash or a false
 * `safe`. `weight` is this detector's share of the aggregate.
 */
export interface Detector {
  readonly name: string;
  readonly weight: number;
  /**
   * True for the detectors that make up the pre-trade gate (`assessQuick`).
   * The gate covers the rug-defining signals — liquidity, LP lock, honeypot,
   * taxes, plus the cheap bytecode/ownership checks — so it must never buy
   * blind. Kept fast by running in parallel under a bounded gate timeout and
   * caching per token; the full `assess()` adds the remaining, slower-signal
   * detectors (e.g. supply concentration) for the async deep analysis.
   */
  readonly fast: boolean;
  detect(ctx: DetectorContext): Promise<Omit<RiskFactor, "detector" | "weight">>;
}

/** Score used when a detector errors or times out — cautious, never `safe`. */
export const INDETERMINATE_SCORE = 50;
