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
