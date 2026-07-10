import type { RiskScore, Trade } from "@bot/domain";
import { InfraError } from "@bot/errors";
import { createLogger } from "@bot/logger";
import { describe, expect, it, vi } from "vitest";
import { TradingEngine } from "./engine";
import { SlippageError } from "./errors";
import { PaperExecutor } from "./paper-executor";
import { InMemoryPositionStore } from "./positions";
import type { Executor } from "./ports";
import { buyIntent, pool, sellIntent, stubRouter } from "./test-helpers";

const silent = createLogger({ destination: { write: () => {} } });
const noSleep = async () => {};

function engineWith(executor: Executor, extra = {}) {
  return new TradingEngine({
    executor,
    positions: new InMemoryPositionStore(),
    logger: silent,
    sleep: noSleep,
    ...extra,
  });
}

const settledTrade: Trade = {
  id: "x",
  chainId: 8453,
  side: "buy",
  token: buyIntent().token,
  amountIn: buyIntent().amountIn,
  amountOut: { raw: 1_000n, decimals: 0 },
  txHash: `0x${"b".repeat(64)}`,
  simulated: true,
};

function fakeExecutor(impl: Executor["execute"]): Executor {
  return { mode: "paper", execute: vi.fn(impl) };
}

describe("TradingEngine", () => {
  it("executes a paper buy end-to-end and opens a position", async () => {
    const { router } = stubRouter(2_000n);
    const engine = engineWith(new PaperExecutor({ router }));
    const result = await engine.trade(buyIntent(), pool, "intent-1");
    expect(result.status).toBe("executed");
    expect(result.trade?.simulated).toBe(true);
    expect(result.position).toMatchObject({ amount: 2_000n });
  });

  it("is idempotent: a replayed intent id does not execute twice", async () => {
    const executor = fakeExecutor(async () => settledTrade);
    const engine = engineWith(executor);
    await engine.trade(buyIntent(), pool, "dup");
    await engine.trade(buyIntent(), pool, "dup");
    expect(executor.execute).toHaveBeenCalledOnce();
  });

  it("retries infrastructure errors with backoff, then succeeds", async () => {
    let calls = 0;
    const executor = fakeExecutor(async () => {
      calls += 1;
      if (calls < 3) throw new InfraError("rpc down");
      return settledTrade;
    });
    const engine = engineWith(executor, { maxRetries: 3 });
    const result = await engine.trade(buyIntent(), pool, "retry-ok");
    expect(result.status).toBe("executed");
    expect(calls).toBe(3);
  });

  it("gives up after maxRetries on persistent infra errors (retryable)", async () => {
    const executor = fakeExecutor(async () => {
      throw new InfraError("still down");
    });
    const engine = engineWith(executor, { maxRetries: 2 });
    const result = await engine.trade(buyIntent(), pool, "retry-fail");
    expect(result).toMatchObject({ status: "failed", retryable: true });
    expect(executor.execute).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("does not retry domain errors (slippage/revert)", async () => {
    const executor = fakeExecutor(async () => {
      throw new SlippageError("below floor");
    });
    const engine = engineWith(executor);
    const result = await engine.trade(buyIntent(), pool, "slip");
    expect(result).toMatchObject({ status: "failed", retryable: false });
    expect(executor.execute).toHaveBeenCalledOnce();
  });

  it("rejects a buy when the pre-trade gate returns danger", async () => {
    const danger: RiskScore = { score: 80, verdict: "danger", factors: [] };
    const executor = fakeExecutor(async () => settledTrade);
    const engine = engineWith(executor, { preTradeCheck: async () => danger });
    const result = await engine.trade(buyIntent(), pool, "gated");
    expect(result.status).toBe("rejected");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("lets a caution verdict through by default (only danger blocks)", async () => {
    const caution: RiskScore = { score: 45, verdict: "caution", factors: [] };
    const executor = fakeExecutor(async () => settledTrade);
    const engine = engineWith(executor, { preTradeCheck: async () => caution });
    const result = await engine.trade(buyIntent(), pool, "caution-default");
    expect(result.status).toBe("executed");
    expect(executor.execute).toHaveBeenCalledOnce();
  });

  it("rejects a caution verdict when rejectAtOrAbove is caution", async () => {
    const caution: RiskScore = { score: 45, verdict: "caution", factors: [] };
    const executor = fakeExecutor(async () => settledTrade);
    const engine = engineWith(executor, {
      preTradeCheck: async () => caution,
      rejectAtOrAbove: "caution",
    });
    const result = await engine.trade(buyIntent(), pool, "caution-blocked");
    expect(result).toMatchObject({
      status: "rejected",
      reason: expect.stringContaining("caution"),
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("still lets a safe verdict through when rejectAtOrAbove is caution", async () => {
    const safe: RiskScore = { score: 10, verdict: "safe", factors: [] };
    const executor = fakeExecutor(async () => settledTrade);
    const engine = engineWith(executor, {
      preTradeCheck: async () => safe,
      rejectAtOrAbove: "caution",
    });
    const result = await engine.trade(buyIntent(), pool, "safe-through");
    expect(result.status).toBe("executed");
  });

  it("does not gate sells", async () => {
    const danger: RiskScore = { score: 80, verdict: "danger", factors: [] };
    const check = vi.fn(async () => danger);
    const executor = fakeExecutor(async () => ({ ...settledTrade, side: "sell" }));
    const engine = engineWith(executor, { preTradeCheck: check });
    const result = await engine.trade(sellIntent(), pool, "sell-1");
    expect(result.status).toBe("executed");
    expect(check).not.toHaveBeenCalled();
  });
});
