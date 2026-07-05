import type { DexAdapter, Quote } from "@bot/dex-adapters";
import { describe, expect, it, vi } from "vitest";
import { QuotePriceSource } from "./price";
import { PRICE_SCALE } from "./rules";
import { MEME, pool, rule } from "./test-helpers";

const r = rule("stop-loss", {
  kind: "stop-loss",
  entryPrice: PRICE_SCALE,
  lossBps: 1_000,
  sellFractionBps: 10_000,
  maxSlippageBps: 100,
});

function adapterReturning(amountOut: bigint | "throw"): DexAdapter {
  const quote: Quote = {
    pool,
    tokenIn: MEME,
    tokenOut: pool.token0,
    amountIn: PRICE_SCALE,
    amountOut: amountOut === "throw" ? 0n : amountOut,
  };
  return {
    dex: "uniswap-v2",
    getPool: vi.fn(),
    getPoolState: vi.fn(),
    quoteExactIn: vi.fn(async () => {
      if (amountOut === "throw") throw new Error("no liquidity");
      return quote;
    }),
    buildSwapCalldata: vi.fn(),
  } as unknown as DexAdapter;
}

describe("QuotePriceSource", () => {
  it("prices a token from a real sell quote, scaled", async () => {
    // Sell 1e18 token → 2e18 quote base units ⇒ price = 2·SCALE.
    const source = new QuotePriceSource({ adapterFor: () => adapterReturning(2n * PRICE_SCALE) });
    await expect(source.priceOf(r)).resolves.toBe(2n * PRICE_SCALE);
  });

  it("returns undefined when the quote is zero or fails", async () => {
    await expect(
      new QuotePriceSource({ adapterFor: () => adapterReturning(0n) }).priceOf(r),
    ).resolves.toBeUndefined();
    await expect(
      new QuotePriceSource({ adapterFor: () => adapterReturning("throw") }).priceOf(r),
    ).resolves.toBeUndefined();
  });
});
