import type { Trade } from "@bot/domain";
import type { EventBus, EventOf, Unsubscribe } from "@bot/events";
import { createLogger, type Logger } from "@bot/logger";
import { PRICE_SCALE, type StrategyRule, type StrategyStore } from "@bot/strategies-core";
import type { PoolRegistry } from "./sniper.js";

/** Levels the take-profit / stop-loss exits are armed with. */
export interface ExitConfig {
  /** Take-profit trigger: sell when price ≥ entry × (1 + gainBps/10000). */
  gainBps: number;
  /** Stop-loss trigger: sell when price ≤ entry × (1 − lossBps/10000). */
  lossBps: number;
  /** Fraction of the position each exit sells, in bps (10000 = all). */
  sellFractionBps: number;
  /** Max slippage tolerated on the exit sell, in bps. */
  maxSlippageBps: number;
}

export interface ExitArmerOptions {
  bus: EventBus;
  store: StrategyStore;
  registry: PoolRegistry;
  /** Wallet the exit sells execute against — must match the entry's wallet. */
  walletId: string;
  config: ExitConfig;
  logger?: Logger;
  now?: () => number;
  group?: string;
}

/**
 * The realized entry price of a buy fill, in the runner's price scale (quote
 * base units per 1e18 token base units): `amountIn (quote) · SCALE / amountOut
 * (token)`.
 *
 * Note this is the *buy-side* price — what was actually paid, spread included.
 * The runner prices exits from a live *sell* quote, which sits a round-trip
 * spread below this the instant after the buy. So a stop-loss must be set wider
 * than that spread or it can trigger immediately; keep `lossBps` generous.
 */
export function entryPriceOf(trade: Trade): bigint | undefined {
  const out = trade.amountOut.raw;
  if (out === 0n) return undefined;
  const price = (trade.amountIn.raw * PRICE_SCALE) / out;
  return price === 0n ? undefined : price;
}

/**
 * Build the take-profit and stop-loss rules that manage a freshly opened
 * position. Both read their entry price from the fill and sell against the same
 * book (`simulated`) and wallet as the entry, so the runner's position lookup
 * and the resulting sell intents line up.
 */
export function buildExitRules(
  trade: Trade,
  pool: StrategyRule["pool"],
  walletId: string,
  config: ExitConfig,
  at: number,
): StrategyRule[] {
  const entryPrice = entryPriceOf(trade);
  if (entryPrice === undefined) return [];

  const base = {
    chainId: trade.chainId,
    token: trade.token,
    pool,
    walletId,
    simulated: trade.simulated,
    status: "active" as const,
    state: {},
    createdAt: at,
    updatedAt: at,
  };

  const tokenKey = trade.token.toLowerCase();
  return [
    {
      ...base,
      id: `tp:${tokenKey}`,
      type: "take-profit",
      params: {
        kind: "take-profit",
        entryPrice,
        gainBps: config.gainBps,
        sellFractionBps: config.sellFractionBps,
        maxSlippageBps: config.maxSlippageBps,
      },
    },
    {
      ...base,
      id: `sl:${tokenKey}`,
      type: "stop-loss",
      params: {
        kind: "stop-loss",
        entryPrice,
        lossBps: config.lossBps,
        sellFractionBps: config.sellFractionBps,
        maxSlippageBps: config.maxSlippageBps,
      },
    },
  ];
}

/**
 * Wires exit management onto the bus: every executed *buy* opens or adds to a
 * position, so arm a take-profit and a stop-loss for it. The StrategyRunner
 * then evaluates them each tick and fires the sell when a level is crossed.
 *
 * Idempotent per token by rule id (`tp:`/`sl:`): re-arming overwrites with the
 * latest fill's entry price rather than stacking duplicate exits. (Averaging an
 * entry across multiple buys — e.g. DCA — is out of scope here; the snipe flow
 * is one buy per token.)
 */
export async function attachExitArmer(options: ExitArmerOptions): Promise<Unsubscribe> {
  const now = options.now ?? Date.now;
  const logger = options.logger ?? createLogger({ name: "exit-armer" });
  const group = options.group ?? "worker-exits";

  const handle = async (event: EventOf<"trade.executed">): Promise<void> => {
    const { trade } = event.payload;
    if (trade.side !== "buy") return; // only entries open a position to protect

    const pool = options.registry.poolFor(trade.token);
    if (pool === undefined) {
      // No pool to price/route the exit against — the entry must have routed
      // through one, so this is unexpected; skip rather than arm a dead rule.
      logger.warn({ token: trade.token }, "no pool to arm exits against; skipping");
      return;
    }

    const rules = buildExitRules(trade, pool, options.walletId, options.config, now());
    if (rules.length === 0) {
      logger.warn({ token: trade.token, txHash: trade.txHash }, "unpriceable fill; no exits armed");
      return;
    }

    for (const rule of rules) {
      await options.store.upsert(rule);
    }
    logger.info(
      {
        token: trade.token,
        simulated: trade.simulated,
        entryPrice: (rules[0]?.params as { entryPrice: bigint }).entryPrice.toString(),
        gainBps: options.config.gainBps,
        lossBps: options.config.lossBps,
      },
      "armed take-profit + stop-loss",
    );
  };

  return options.bus.subscribe("trade.executed", handle, { group });
}
