import {
  toAddress,
  tokenAmount,
  type Address,
  type Pool,
  type Trade,
  type TradeIntent,
} from "@bot/domain";
import type {
  ExecuteRequest,
  Executor,
  PositionRecord,
  PositionStore,
} from "@bot/engine-core";
import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  NotionalCapExceededError,
  PortfolioLimitExceededError,
  withNotionalCap,
  withPortfolioLimits,
} from "./guard.js";

const CHAIN_ID = 8453;
const TOKEN = toAddress(getAddress("0x1111111111111111111111111111111111111111"));
const POOL_ADDR = toAddress(getAddress("0x2222222222222222222222222222222222222222"));
const TX_HASH = `0x${"22".repeat(32)}` as const;

function pool(): Pool {
  return {
    chainId: CHAIN_ID,
    address: POOL_ADDR,
    dex: "uniswap-v3",
    token0: TOKEN,
    token1: TOKEN,
    feeTier: 3000,
  };
}

function intent(side: "buy" | "sell", amountIn: bigint): TradeIntent {
  return {
    chainId: CHAIN_ID,
    side,
    token: TOKEN,
    amountIn: tokenAmount(amountIn, 0),
    maxSlippageBps: 500,
    simulated: false,
  };
}

function request(side: "buy" | "sell", amountIn: bigint): ExecuteRequest {
  return { intent: intent(side, amountIn), pool: pool(), intentId: "intent-1" };
}

function fakeExecutor(): Executor {
  const trade: Trade = {
    id: "intent-1",
    chainId: CHAIN_ID,
    side: "buy",
    token: TOKEN,
    amountIn: tokenAmount(100n, 0),
    amountOut: tokenAmount(1n, 0),
    txHash: TX_HASH,
    simulated: false,
  };
  return { mode: "live", execute: vi.fn().mockResolvedValue(trade) };
}

describe("withNotionalCap", () => {
  it("passes a buy at or under the cap through to the inner executor", async () => {
    const inner = fakeExecutor();
    const capped = withNotionalCap(inner, 100n);
    await capped.execute(request("buy", 100n));
    expect(inner.execute).toHaveBeenCalledOnce();
  });

  it("rejects a buy over the cap with a terminal DomainError, without executing", async () => {
    const inner = fakeExecutor();
    const capped = withNotionalCap(inner, 50n);
    await expect(capped.execute(request("buy", 51n))).rejects.toBeInstanceOf(
      NotionalCapExceededError,
    );
    expect(inner.execute).not.toHaveBeenCalled();
  });

  it("does not cap sells — a sell's amountIn is the token, not the quote", async () => {
    const inner = fakeExecutor();
    const capped = withNotionalCap(inner, 50n);
    await capped.execute(request("sell", 1_000n));
    expect(inner.execute).toHaveBeenCalledOnce();
  });

  it("preserves the inner executor's mode", () => {
    expect(withNotionalCap(fakeExecutor(), 1n).mode).toBe("live");
  });
});

function position(token: Address, amount: bigint, costBasis: bigint, simulated = false): PositionRecord {
  return {
    id: `pos-${token}`,
    chainId: CHAIN_ID,
    token,
    simulated,
    amount,
    costBasis,
    realizedPnl: 0n,
    openedAt: 0,
    updatedAt: 0,
  };
}

function fakeStore(records: PositionRecord[]): Pick<PositionStore, "list"> {
  return { list: vi.fn().mockResolvedValue(records) };
}

function otherToken(n: number): Address {
  return toAddress(getAddress(`0x${n.toString(16).padStart(40, "0")}`));
}

describe("withPortfolioLimits", () => {
  const limits = { maxOpenPositions: 3, maxTotalNotionalWei: 0n };

  it("passes a buy through when under the position cap", async () => {
    const inner = fakeExecutor();
    const guarded = withPortfolioLimits(inner, fakeStore([position(otherToken(9), 5n, 100n)]), limits);
    await guarded.execute(request("buy", 100n));
    expect(inner.execute).toHaveBeenCalledOnce();
  });

  it("rejects a new position once the open-position cap is reached", async () => {
    const inner = fakeExecutor();
    const open = [otherToken(1), otherToken(2), otherToken(3)].map((t) => position(t, 5n, 100n));
    const guarded = withPortfolioLimits(inner, fakeStore(open), limits);
    await expect(guarded.execute(request("buy", 100n))).rejects.toBeInstanceOf(
      PortfolioLimitExceededError,
    );
    expect(inner.execute).not.toHaveBeenCalled();
  });

  it("still allows adding to a token already held at the cap (no new slot)", async () => {
    const inner = fakeExecutor();
    // Three open, but one of them IS the intent's token → not a new position.
    const open = [position(TOKEN, 5n, 100n), position(otherToken(2), 5n, 100n), position(otherToken(3), 5n, 100n)];
    const guarded = withPortfolioLimits(inner, fakeStore(open), limits);
    await guarded.execute(request("buy", 100n));
    expect(inner.execute).toHaveBeenCalledOnce();
  });

  it("rejects a buy that would breach the total-notional cap", async () => {
    const inner = fakeExecutor();
    const open = [position(otherToken(1), 5n, 900n)];
    const guarded = withPortfolioLimits(inner, fakeStore(open), {
      maxOpenPositions: 0,
      maxTotalNotionalWei: 1_000n,
    });
    await expect(guarded.execute(request("buy", 101n))).rejects.toBeInstanceOf(
      PortfolioLimitExceededError,
    );
    expect(inner.execute).not.toHaveBeenCalled();
  });

  it("counts only the matching book (paper vs live) toward the cap", async () => {
    const inner = fakeExecutor();
    // Three open positions but all simulated — a live buy sees an empty live book.
    const open = [otherToken(1), otherToken(2), otherToken(3)].map((t) =>
      position(t, 5n, 100n, true),
    );
    const guarded = withPortfolioLimits(inner, fakeStore(open), limits);
    await guarded.execute(request("buy", 100n)); // request() builds a live (simulated:false) intent
    expect(inner.execute).toHaveBeenCalledOnce();
  });

  it("does not gate sells", async () => {
    const inner = fakeExecutor();
    const open = [otherToken(1), otherToken(2), otherToken(3)].map((t) => position(t, 5n, 100n));
    const guarded = withPortfolioLimits(inner, fakeStore(open), limits);
    await guarded.execute(request("sell", 5n));
    expect(inner.execute).toHaveBeenCalledOnce();
  });

  it("skips the store entirely when both limits are disabled", async () => {
    const inner = fakeExecutor();
    const store = fakeStore([]);
    const guarded = withPortfolioLimits(inner, store, { maxOpenPositions: 0, maxTotalNotionalWei: 0n });
    await guarded.execute(request("buy", 100n));
    expect(store.list).not.toHaveBeenCalled();
    expect(inner.execute).toHaveBeenCalledOnce();
  });
});
