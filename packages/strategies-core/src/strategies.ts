import { tokenAmount, type TradeIntent } from "@bot/domain";
import type { Strategy, StrategyAction, StrategyContext } from "./ports";
import type {
  DcaParams,
  LimitParams,
  StopLossParams,
  StrategyRule,
  TakeProfitParams,
  TrailingStopParams,
} from "./rules";

const BPS = 10_000n;

function sellIntent(
  rule: StrategyRule,
  tokenAmountRaw: bigint,
  maxSlippageBps: number,
): TradeIntent {
  return {
    chainId: rule.chainId,
    side: "sell",
    token: rule.token,
    amountIn: tokenAmount(tokenAmountRaw, 0),
    maxSlippageBps,
    simulated: rule.simulated,
  };
}

function buyIntent(
  rule: StrategyRule,
  quoteAmountRaw: bigint,
  maxSlippageBps: number,
): TradeIntent {
  return {
    chainId: rule.chainId,
    side: "buy",
    token: rule.token,
    amountIn: tokenAmount(quoteAmountRaw, 0),
    maxSlippageBps,
    simulated: rule.simulated,
  };
}

/** Sell `fractionBps` of the held amount, at least 1 base unit when non-zero. */
function sellFraction(positionAmount: bigint, fractionBps: number): bigint {
  return (positionAmount * BigInt(fractionBps)) / BPS;
}

/** #1 — Limit: fire once when price crosses the trigger in the set direction. */
export const limitStrategy: Strategy = {
  type: "limit",
  evaluate(ctx: StrategyContext): StrategyAction[] {
    const params = ctx.rule.params as LimitParams;
    if (ctx.price === undefined) return [];
    const crossed =
      params.direction === "above"
        ? ctx.price >= params.triggerPrice
        : ctx.price <= params.triggerPrice;
    if (!crossed) return [];
    const intent =
      params.side === "buy"
        ? buyIntent(ctx.rule, params.amount, params.maxSlippageBps)
        : sellIntent(ctx.rule, minBig(params.amount, ctx.positionAmount), params.maxSlippageBps);
    if (params.side === "sell" && ctx.positionAmount === 0n) return [];
    return [
      { kind: "emit", intent },
      { kind: "status", status: "triggered" },
    ];
  },
};

/** #2 — Take-profit: sell a fraction when price ≥ entry × (1 + gainBps). */
export const takeProfitStrategy: Strategy = {
  type: "take-profit",
  evaluate(ctx: StrategyContext): StrategyAction[] {
    const params = ctx.rule.params as TakeProfitParams;
    if (ctx.price === undefined || ctx.positionAmount === 0n) return [];
    const target = (params.entryPrice * (BPS + BigInt(params.gainBps))) / BPS;
    if (ctx.price < target) return [];
    return sellFractionActions(ctx, params.sellFractionBps, params.maxSlippageBps);
  },
};

/** #3 — Stop-loss: sell a fraction when price ≤ entry × (1 − lossBps). */
export const stopLossStrategy: Strategy = {
  type: "stop-loss",
  evaluate(ctx: StrategyContext): StrategyAction[] {
    const params = ctx.rule.params as StopLossParams;
    if (ctx.price === undefined || ctx.positionAmount === 0n) return [];
    const floor = (params.entryPrice * (BPS - BigInt(params.lossBps))) / BPS;
    if (ctx.price > floor) return [];
    return sellFractionActions(ctx, params.sellFractionBps, params.maxSlippageBps);
  },
};

/**
 * #4 — Trailing stop: track the high-water mark; sell when price falls
 * `trailingBps` below it. The updated high-water mark is persisted every tick,
 * even when not selling — that is the strategy's memory.
 */
export const trailingStopStrategy: Strategy = {
  type: "trailing-stop",
  evaluate(ctx: StrategyContext): StrategyAction[] {
    const params = ctx.rule.params as TrailingStopParams;
    if (ctx.price === undefined || ctx.positionAmount === 0n) return [];
    const prevHigh = ctx.rule.state.highWaterMark ?? 0n;
    const high = ctx.price > prevHigh ? ctx.price : prevHigh;
    const stop = (high * (BPS - BigInt(params.trailingBps))) / BPS;
    if (ctx.price <= stop && high > 0n) {
      return sellFractionActions(ctx, params.sellFractionBps, params.maxSlippageBps);
    }
    // Not triggered: just remember the (possibly new) high.
    if (high !== prevHigh) {
      return [{ kind: "state", state: { ...ctx.rule.state, highWaterMark: high } }];
    }
    return [];
  },
};

/**
 * #5 — DCA: buy `amountPerBuy` every `intervalMs`, `totalBuys` times. State
 * carries the tranche count and the next eligible time; the rule goes `done`
 * after the last tranche.
 */
export const dcaStrategy: Strategy = {
  type: "dca",
  evaluate(ctx: StrategyContext): StrategyAction[] {
    const params = ctx.rule.params as DcaParams;
    const count = ctx.rule.state.dcaCount ?? 0;
    if (count >= params.totalBuys) {
      return [{ kind: "status", status: "done" }];
    }
    const nextAt = ctx.rule.state.nextDcaAt ?? 0;
    if (ctx.now < nextAt) return [];
    const nextCount = count + 1;
    const actions: StrategyAction[] = [
      { kind: "emit", intent: buyIntent(ctx.rule, params.amountPerBuy, params.maxSlippageBps) },
      {
        kind: "state",
        state: { ...ctx.rule.state, dcaCount: nextCount, nextDcaAt: ctx.now + params.intervalMs },
      },
    ];
    if (nextCount >= params.totalBuys) {
      actions.push({ kind: "status", status: "done" });
    }
    return actions;
  },
};

function sellFractionActions(
  ctx: StrategyContext,
  fractionBps: number,
  maxSlippageBps: number,
): StrategyAction[] {
  const amount = sellFraction(ctx.positionAmount, fractionBps);
  if (amount === 0n) return [];
  return [
    { kind: "emit", intent: sellIntent(ctx.rule, amount, maxSlippageBps) },
    { kind: "status", status: "triggered" },
  ];
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** The five strategies, keyed by type. */
export function defaultStrategies(): Map<StrategyRule["type"], Strategy> {
  return new Map(
    [limitStrategy, takeProfitStrategy, stopLossStrategy, trailingStopStrategy, dcaStrategy].map(
      (strategy) => [strategy.type, strategy],
    ),
  );
}
