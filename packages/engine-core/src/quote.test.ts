import type { Quote } from "@bot/dex-adapters";
import { describe, expect, it } from "vitest";
import { SlippageError } from "./errors";
import { assertWithinSlippage, minOut, tokenInFor } from "./quote";
import { buyIntent, MEME, pool, sellIntent, WETH } from "./test-helpers";

const quote: Quote = {
  pool,
  tokenIn: WETH,
  tokenOut: MEME,
  amountIn: 10n ** 18n,
  amountOut: 1_000n,
};

describe("tokenInFor", () => {
  it("spends the quote token on a buy and the token on a sell", () => {
    expect(tokenInFor(buyIntent(), pool)).toBe(WETH);
    expect(tokenInFor(sellIntent(), pool)).toBe(MEME);
  });
});

describe("minOut", () => {
  it("applies slippage in bps, rounding down", () => {
    expect(minOut(quote, 100)).toBe(990n); // 1%
    expect(minOut(quote, 0)).toBe(1_000n);
    expect(minOut({ ...quote, amountOut: 3n }, 1)).toBe(2n);
  });
});

describe("assertWithinSlippage", () => {
  it("passes at or above the floor", () => {
    expect(() => assertWithinSlippage(1_000n, 990n, "0xtoken")).not.toThrow();
    expect(() => assertWithinSlippage(990n, 990n, "0xtoken")).not.toThrow();
  });

  it("throws a (non-retryable) SlippageError below the floor", () => {
    expect(() => assertWithinSlippage(989n, 990n, "0xtoken")).toThrow(SlippageError);
  });
});
