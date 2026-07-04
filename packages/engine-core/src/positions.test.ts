import { tokenAmount, type Trade } from "@bot/domain";
import { describe, expect, it } from "vitest";
import { applyTrade, InMemoryPositionStore } from "./positions";
import { MEME } from "./test-helpers";

const now = () => 1_000;

function trade(side: "buy" | "sell", amountIn: bigint, amountOut: bigint): Trade {
  return {
    id: `${side}-${amountIn}`,
    chainId: 8453,
    side,
    token: MEME,
    amountIn: tokenAmount(amountIn, 0),
    amountOut: tokenAmount(amountOut, 0),
    txHash: `0x${"1".repeat(64)}`,
    simulated: true,
  };
}

describe("applyTrade", () => {
  it("opens a position on the first buy", async () => {
    const store = new InMemoryPositionStore();
    // Buy: spend 1 WETH (amountIn), receive 1000 MEME (amountOut).
    const position = await applyTrade(store, trade("buy", 10n ** 18n, 1_000n), now);
    expect(position).toMatchObject({ amount: 1_000n, costBasis: 10n ** 18n, realizedPnl: 0n });
  });

  it("averages the cost basis across successive buys", async () => {
    const store = new InMemoryPositionStore();
    await applyTrade(store, trade("buy", 100n, 1_000n), now);
    const position = await applyTrade(store, trade("buy", 300n, 1_000n), now);
    expect(position).toMatchObject({ amount: 2_000n, costBasis: 400n });
  });

  it("realizes PnL on a partial sell, proportional to basis", async () => {
    const store = new InMemoryPositionStore();
    await applyTrade(store, trade("buy", 1_000n, 1_000n), now); // basis 1000 for 1000 tokens
    // Sell half the tokens for 800 quote: basis of the sold half = 500.
    const position = await applyTrade(store, trade("sell", 500n, 800n), now);
    expect(position).toMatchObject({ amount: 500n, costBasis: 500n, realizedPnl: 300n });
  });

  it("closes and removes the position on a full sell", async () => {
    const store = new InMemoryPositionStore();
    await applyTrade(store, trade("buy", 1_000n, 1_000n), now);
    const position = await applyTrade(store, trade("sell", 1_000n, 1_500n), now);
    expect(position?.amount).toBe(0n);
    expect(position?.realizedPnl).toBe(500n);
    await expect(store.list()).resolves.toHaveLength(0);
  });

  it("ignores a sell with no tracked position", async () => {
    const store = new InMemoryPositionStore();
    const position = await applyTrade(store, trade("sell", 100n, 200n), now);
    expect(position).toBeUndefined();
    await expect(store.list()).resolves.toHaveLength(0);
  });

  it("keeps paper and live positions separate", async () => {
    const store = new InMemoryPositionStore();
    await applyTrade(store, trade("buy", 100n, 1_000n), now);
    const live: Trade = { ...trade("buy", 200n, 2_000n), simulated: false };
    await applyTrade(store, live, now);
    await expect(store.list()).resolves.toHaveLength(2);
  });
});
