import type { Address, ChainId, Pool } from "@bot/domain";

/** Price scale: a `Price` is quote-token base units per 1e18 token base units. */
export const PRICE_SCALE = 10n ** 18n;
export type Price = bigint;

export type StrategyType = "limit" | "take-profit" | "stop-loss" | "trailing-stop" | "dca";
export type StrategyStatus = "active" | "triggered" | "done" | "cancelled";

/**
 * A persisted strategy rule. `params` and `state` are type-specific; the
 * discriminated helpers below narrow them. `state` is mutated by the runner
 * (trailing high-water mark, DCA progress) and persisted after each tick.
 */
export interface StrategyRule {
  id: string;
  type: StrategyType;
  chainId: ChainId;
  token: Address;
  pool: Pool;
  walletId: string;
  simulated: boolean;
  status: StrategyStatus;
  params: StrategyParams;
  state: StrategyState;
  createdAt: number;
  updatedAt: number;
}

export type StrategyParams =
  LimitParams | TakeProfitParams | StopLossParams | TrailingStopParams | DcaParams;

/** Buy or sell when price crosses `triggerPrice` in `direction`. */
export interface LimitParams {
  kind: "limit";
  side: "buy" | "sell";
  triggerPrice: Price;
  direction: "above" | "below";
  /** Quote base units to spend (buy) or token base units to sell. */
  amount: bigint;
  maxSlippageBps: number;
}

/** Sell a fraction of the position when price ≥ entry × (1 + gainBps). */
export interface TakeProfitParams {
  kind: "take-profit";
  entryPrice: Price;
  gainBps: number;
  /** Fraction of the position to sell, in bps (10000 = all). */
  sellFractionBps: number;
  maxSlippageBps: number;
}

/** Sell a fraction of the position when price ≤ entry × (1 − lossBps). */
export interface StopLossParams {
  kind: "stop-loss";
  entryPrice: Price;
  lossBps: number;
  sellFractionBps: number;
  maxSlippageBps: number;
}

/** Sell when price falls `trailingBps` below the observed high-water mark. */
export interface TrailingStopParams {
  kind: "trailing-stop";
  trailingBps: number;
  sellFractionBps: number;
  maxSlippageBps: number;
}

/** Buy `amountPerBuy` every `intervalMs`, `totalBuys` times. */
export interface DcaParams {
  kind: "dca";
  amountPerBuy: bigint;
  intervalMs: number;
  totalBuys: number;
  maxSlippageBps: number;
}

export interface StrategyState {
  /** Trailing stop: highest price seen so far. */
  highWaterMark?: Price;
  /** DCA: number of tranches already bought. */
  dcaCount?: number;
  /** DCA: earliest time (epoch ms) the next tranche may fire. */
  nextDcaAt?: number;
}
