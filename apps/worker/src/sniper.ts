import { BASE_WETH } from "@bot/dex-adapters";
import type { Address, ChainId, Pool } from "@bot/domain";
import type { EventBus, EventOf, Unsubscribe } from "@bot/events";
import { createLogger, type Logger } from "@bot/logger";
import type { StrategyRule, StrategyStore } from "@bot/strategies-core";

/**
 * token (lower-cased) → the pool it was most recently seen in. Shared between
 * the sniper (which arms a rule per detected token) and the engine's
 * `resolvePool` (which needs a pool to route the resulting buy through).
 */
export class PoolRegistry {
  readonly #byToken = new Map<string, Pool>();

  record(token: Address, pool: Pool): void {
    this.#byToken.set(token.toLowerCase(), pool);
  }

  poolFor(token: Address): Pool | undefined {
    return this.#byToken.get(token.toLowerCase());
  }
}

export interface SnipeRuleInput {
  chainId: ChainId;
  token: Address;
  pool: Pool;
  /** WETH (quote) base units to spend on the single snipe buy. */
  quoteAmount: bigint;
  maxSlippageBps: number;
  at: number;
  /** Wallet the buy executes against. Default `"paper"` (no real key). */
  walletId?: string;
  /** Paper vs live book. Default `true` (paper). Must be `false` for live. */
  simulated?: boolean;
}

/** Build a `snipe` rule for a token — one-shot buy, never rebuys. */
export function buildSnipeRule(input: SnipeRuleInput): StrategyRule {
  const id = `snipe:${input.token.toLowerCase()}`;
  return {
    id,
    type: "snipe",
    chainId: input.chainId,
    token: input.token,
    pool: input.pool,
    walletId: input.walletId ?? "paper",
    simulated: input.simulated ?? true,
    status: "active",
    params: {
      kind: "snipe",
      quoteAmount: input.quoteAmount,
      maxSlippageBps: input.maxSlippageBps,
    },
    state: {},
    createdAt: input.at,
    updatedAt: input.at,
  };
}

export interface SniperOptions {
  bus: EventBus;
  store: StrategyStore;
  registry: PoolRegistry;
  /** WETH (quote) base units to spend on each snipe. */
  quoteAmount: bigint;
  maxSlippageBps: number;
  /** Wallet the snipe buys execute against. Default `"paper"`. */
  walletId?: string;
  /** Paper vs live book. Default `true` (paper). Must be `false` for live. */
  simulated?: boolean;
  now?: () => number;
  logger?: Logger;
  group?: string;
}

/**
 * Turns each detected token into a one-shot paper snipe: record its pool for
 * routing, then upsert an active `snipe` rule the StrategyRunner fires on its
 * next tick — once the pool quotes a live price. Idempotent per token (a rule
 * that already exists is left untouched) and skips WETH itself.
 */
export async function attachSniper(options: SniperOptions): Promise<Unsubscribe> {
  const now = options.now ?? Date.now;
  const logger = options.logger ?? createLogger({ name: "sniper" });
  const group = options.group ?? "worker-sniper";

  const handle = async (event: EventOf<"token.detected">): Promise<void> => {
    const { token, pool } = event.payload;
    if (pool === undefined) return; // no pool = nothing to route or price against
    if (token.address.toLowerCase() === BASE_WETH.toLowerCase()) return;

    options.registry.record(token.address, pool);

    const id = `snipe:${token.address.toLowerCase()}`;
    if ((await options.store.get(id)) !== undefined) return; // already armed

    await options.store.upsert(
      buildSnipeRule({
        chainId: token.chainId,
        token: token.address,
        pool,
        quoteAmount: options.quoteAmount,
        maxSlippageBps: options.maxSlippageBps,
        at: now(),
        walletId: options.walletId,
        simulated: options.simulated,
      }),
    );
    logger.info(
      { token: token.address, symbol: token.symbol, pool: pool.address },
      "armed paper snipe",
    );
  };

  return options.bus.subscribe("token.detected", handle, { group });
}
