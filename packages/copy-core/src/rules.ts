import type { Address, ChainId, TradeSide } from "@bot/domain";

/** Hard cap on how many wallets a tenant may follow at once. */
export const MAX_TRACKED_WALLETS = 50;

/** How a copied trade is sized relative to the leader's move. */
export type CopyMode = "percent" | "fixed";

/**
 * A wallet the bot follows ("leader"). Its on-chain swaps are mirrored into
 * `buy.requested` / `sell.requested` intents according to this config. Pure
 * data — persisted as-is, evaluated deterministically by {@link CopyPolicy}.
 */
export interface TrackedWallet {
  id: string;
  chainId: ChainId;
  /** Leader address to watch. */
  address: Address;
  label?: string;
  /** `percent`: copy `sizeBps` of the leader's spend. `fixed`: spend a set amount. */
  mode: CopyMode;
  /** Fraction of the leader's spend to copy, in bps (10000 = 1:1). `percent` only. */
  sizeBps?: number;
  /** Quote base units to spend per copied buy. `fixed` only. */
  fixedAmountIn?: bigint;
  /** Max acceptable slippage on the copied trade, in bps. */
  maxSlippageBps: number;
  /** When set and non-empty, only these tokens are copied. */
  allowTokens?: Address[];
  /** Tokens never copied (takes precedence over the allow-list). */
  denyTokens?: Address[];
  /** Skip a copied buy whose sized amount falls below this floor (quote base units). */
  minAmountIn?: bigint;
  /** Clamp a copied buy's amount to this ceiling (quote base units). */
  maxAmountIn?: bigint;
  /** Mirror the leader's sells (out of our own position). */
  copySells: boolean;
  /** Paper trading: the emitted intents stay simulated. */
  simulated: boolean;
  /** Only enabled wallets are watched and count against {@link MAX_TRACKED_WALLETS}. */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * A swap performed by a tracked wallet, decoded from ERC20 `Transfer` logs of
 * a single transaction. Reference-token in / token out is a buy; token in /
 * reference-token out is a sell. Pure data handed to the policy — the decoder
 * never guesses beyond the transfers it can see.
 */
export interface ObservedSwap {
  walletId: string;
  chainId: ChainId;
  /** Transaction that carried the swap. */
  txHash: string;
  /** Representative log index (the reference-token leg) — the dedup discriminator. */
  logIndex: number;
  side: TradeSide;
  /** The non-reference token bought or sold. */
  token: Address;
  /** The reference token (e.g. WETH) on the other leg. */
  referenceToken: Address;
  /** Base units spent by the leader: reference on a buy, token on a sell. */
  amountIn: bigint;
  /** Base units received by the leader: token on a buy, reference on a sell. */
  amountOut: bigint;
  blockNumber: bigint;
}
