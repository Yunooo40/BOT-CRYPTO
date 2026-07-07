import { describe, expect, it } from "vitest";
import type { StrategyAction, StrategyContext } from "./ports";
import {
  dcaStrategy,
  limitStrategy,
  snipeStrategy,
  stopLossStrategy,
  takeProfitStrategy,
  trailingStopStrategy,
} from "./strategies";
import type { StrategyRule } from "./rules";
import { P, rule } from "./test-helpers";

function ctx(
  r: StrategyRule,
  price: bigint | undefined,
  positionAmount: bigint,
  now = 0,
): StrategyContext {
  return { rule: r, price, positionAmount, now };
}

function emitted(actions: StrategyAction[]) {
  return actions.find((a) => a.kind === "emit");
}
function stateOf(actions: StrategyAction[]) {
  const a = actions.find((x) => x.kind === "state");
  return a?.kind === "state" ? a.state : undefined;
}
function statusOf(actions: StrategyAction[]) {
  const a = actions.find((x) => x.kind === "status");
  return a?.kind === "status" ? a.status : undefined;
}

describe("limit strategy", () => {
  const r = rule("limit", {
    kind: "limit",
    side: "buy",
    triggerPrice: P(2),
    direction: "below",
    amount: 1_000n,
    maxSlippageBps: 100,
  });

  it("does not fire above the trigger (direction below)", () => {
    expect(limitStrategy.evaluate(ctx(r, P(2.5), 0n))).toEqual([]);
  });

  it("fires a buy when price crosses below the trigger", () => {
    const actions = limitStrategy.evaluate(ctx(r, P(1.9), 0n));
    expect(emitted(actions)?.kind).toBe("emit");
    expect(statusOf(actions)).toBe("triggered");
  });

  it("fires above the trigger when direction is above", () => {
    const up = rule("limit", { ...r.params, direction: "above", triggerPrice: P(2) } as never);
    expect(emitted(limitStrategy.evaluate(ctx(up, P(2.1), 0n)))).toBeDefined();
    expect(limitStrategy.evaluate(ctx(up, P(1.9), 0n))).toEqual([]);
  });

  it("skips a sell limit with no position", () => {
    const sell = rule("limit", { ...r.params, side: "sell" } as never);
    expect(limitStrategy.evaluate(ctx(sell, P(1.9), 0n))).toEqual([]);
  });
});

describe("take-profit strategy", () => {
  const r = rule("take-profit", {
    kind: "take-profit",
    entryPrice: P(1),
    gainBps: 5_000, // +50%
    sellFractionBps: 5_000, // sell half
    maxSlippageBps: 100,
  });

  it("holds below target", () => {
    expect(takeProfitStrategy.evaluate(ctx(r, P(1.4), 1_000n))).toEqual([]);
  });

  it("sells the configured fraction at/above target", () => {
    const actions = takeProfitStrategy.evaluate(ctx(r, P(1.5), 1_000n));
    const emit = emitted(actions);
    expect(emit?.kind === "emit" && emit.intent.amountIn.raw).toBe(500n);
    expect(statusOf(actions)).toBe("triggered");
  });

  it("does nothing when flat", () => {
    expect(takeProfitStrategy.evaluate(ctx(r, P(2), 0n))).toEqual([]);
  });
});

describe("stop-loss strategy", () => {
  const r = rule("stop-loss", {
    kind: "stop-loss",
    entryPrice: P(1),
    lossBps: 2_000, // -20%
    sellFractionBps: 10_000, // sell all
    maxSlippageBps: 100,
  });

  it("holds above the floor", () => {
    expect(stopLossStrategy.evaluate(ctx(r, P(0.9), 1_000n))).toEqual([]);
  });

  it("sells everything at/below the floor", () => {
    const actions = stopLossStrategy.evaluate(ctx(r, P(0.8), 1_000n));
    const emit = emitted(actions);
    expect(emit?.kind === "emit" && emit.intent.amountIn.raw).toBe(1_000n);
  });
});

describe("trailing-stop strategy", () => {
  const r = rule("trailing-stop", {
    kind: "trailing-stop",
    trailingBps: 1_000, // 10% drop from the high
    sellFractionBps: 10_000,
    maxSlippageBps: 100,
  });

  it("raises the high-water mark as price climbs, without selling", () => {
    const actions = trailingStopStrategy.evaluate(ctx(r, P(2), 1_000n));
    expect(emitted(actions)).toBeUndefined();
    expect(stateOf(actions)?.highWaterMark).toBe(P(2));
  });

  it("sells when price falls trailingBps below the high", () => {
    const withHigh = rule("trailing-stop", r.params, { state: { highWaterMark: P(2) } });
    // 10% below 2.0 is 1.8; at 1.79 it triggers.
    const actions = trailingStopStrategy.evaluate(ctx(withHigh, P(1.79), 1_000n));
    expect(emitted(actions)).toBeDefined();
  });

  it("holds when price is within the trailing band", () => {
    const withHigh = rule("trailing-stop", r.params, { state: { highWaterMark: P(2) } });
    expect(trailingStopStrategy.evaluate(ctx(withHigh, P(1.85), 1_000n))).toEqual([]);
  });
});

describe("dca strategy", () => {
  const r = rule("dca", {
    kind: "dca",
    amountPerBuy: 1_000n,
    intervalMs: 60_000,
    totalBuys: 3,
    maxSlippageBps: 100,
  });

  it("buys the first tranche immediately and schedules the next", () => {
    const actions = dcaStrategy.evaluate(ctx(r, undefined, 0n, 100_000));
    const emit = emitted(actions);
    expect(emit?.kind === "emit" && emit.intent.side).toBe("buy");
    expect(stateOf(actions)).toMatchObject({ dcaCount: 1, nextDcaAt: 160_000 });
  });

  it("waits until the next interval", () => {
    const mid = rule("dca", r.params, { state: { dcaCount: 1, nextDcaAt: 160_000 } });
    expect(dcaStrategy.evaluate(ctx(mid, undefined, 0n, 120_000))).toEqual([]);
  });

  it("marks done after the final tranche", () => {
    const last = rule("dca", r.params, { state: { dcaCount: 2, nextDcaAt: 0 } });
    const actions = dcaStrategy.evaluate(ctx(last, undefined, 0n, 200_000));
    expect(stateOf(actions)?.dcaCount).toBe(3);
    expect(statusOf(actions)).toBe("done");
  });

  it("is done and emits nothing once totalBuys reached", () => {
    const finished = rule("dca", r.params, { state: { dcaCount: 3 } });
    const actions = dcaStrategy.evaluate(ctx(finished, undefined, 0n, 999_999));
    expect(emitted(actions)).toBeUndefined();
    expect(statusOf(actions)).toBe("done");
  });
});

describe("snipe strategy", () => {
  const r = rule("snipe", {
    kind: "snipe",
    quoteAmount: 2_000n,
    maxSlippageBps: 300,
    minLiquidity: 1_000n,
    maxBuyTaxBps: 500,
  });

  it("emits a single buy the first time the pool is live", () => {
    const actions = snipeStrategy.evaluate(ctx(r, P(1), 0n));
    const emit = emitted(actions);
    expect(emit?.kind === "emit" && emit.intent.side).toBe("buy");
    expect(emit?.kind === "emit" && emit.intent.amountIn.raw).toBe(2_000n);
    expect(emit?.kind === "emit" && emit.intent.maxSlippageBps).toBe(300);
    // Exactly one emit, ever.
    expect(actions.filter((a) => a.kind === "emit")).toHaveLength(1);
  });

  it("marks itself sniped and moves to triggered", () => {
    const actions = snipeStrategy.evaluate(ctx(r, P(1), 0n));
    expect(stateOf(actions)?.sniped).toBe(true);
    expect(statusOf(actions)).toBe("triggered");
  });

  it("never rebuys once sniped (state guard)", () => {
    const sniped = rule("snipe", r.params, { state: { sniped: true } });
    expect(snipeStrategy.evaluate(ctx(sniped, P(1.5), 0n))).toEqual([]);
  });

  it("never rebuys once triggered (status guard)", () => {
    const triggered = rule("snipe", r.params, { status: "triggered" });
    expect(snipeStrategy.evaluate(ctx(triggered, P(1.5), 0n))).toEqual([]);
  });

  it("waits while the pool is not live yet (no price = no liquidity)", () => {
    expect(snipeStrategy.evaluate(ctx(r, undefined, 0n))).toEqual([]);
  });

  it("does not double-enter when already holding the token", () => {
    expect(snipeStrategy.evaluate(ctx(r, P(1), 5_000n))).toEqual([]);
  });
});
