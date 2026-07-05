import type { Address, ChainId, TradeIntent } from "@bot/domain";
import type { Price, StrategyRule, StrategyState } from "./rules";

/**
 * Current price of a token, expressed as quote base units per 1e18 token base
 * units (PRICE_SCALE). Derived in production from a real sell quote (M3) of the
 * position amount — the price the engine would actually realize, slippage
 * included — not a theoretical spot. Injected, so it mocks cleanly.
 */
export interface PriceSource {
  priceOf(rule: StrategyRule): Promise<Price | undefined>;
}

/** Persisted position amount for a rule's token (from the engine's book). */
export interface PositionSource {
  amountOf(chainId: ChainId, token: Address, simulated: boolean): Promise<bigint>;
}

/**
 * What a strategy asks the runner to do this tick. Pure data — the strategy
 * never touches the bus, the chain, or a key.
 */
export type StrategyAction =
  | { kind: "emit"; intent: TradeIntent }
  | { kind: "state"; state: StrategyState }
  | { kind: "status"; status: StrategyRule["status"] };

/** Everything a strategy needs to decide, gathered by the runner before evaluate. */
export interface StrategyContext {
  rule: StrategyRule;
  /** Current price, or undefined when unavailable (no liquidity, quote failed). */
  price: Price | undefined;
  /** Token base units currently held (0 when flat). */
  positionAmount: bigint;
  now: number;
}

/**
 * A trading strategy: pure and deterministic. Given a context, it returns the
 * actions to take — never mutating anything itself. The runner applies them
 * (publish intents, persist state/status).
 */
export interface Strategy {
  readonly type: StrategyRule["type"];
  evaluate(ctx: StrategyContext): StrategyAction[];
}

export interface StrategyStore {
  upsert(rule: StrategyRule): Promise<void>;
  get(id: string): Promise<StrategyRule | undefined>;
  /** Active rules only — what the runner ticks. */
  listActive(): Promise<StrategyRule[]>;
  list(): Promise<StrategyRule[]>;
}

export type { Price };
