import { ValidationError } from "@bot/errors";
import { describe, expect, it } from "vitest";
import { applySlippage, getAmountOutV2, priceImpactBps } from "./math";

describe("getAmountOutV2", () => {
  it("matches the classic Uniswap V2 vector (0.3% fee)", () => {
    // amountIn 1000 into 10000/10000: (1000·0.997·10000)/(10000+1000·0.997)
    expect(getAmountOutV2(1000n, 10_000n, 10_000n)).toBe(906n);
  });

  it("is fee-sensitive", () => {
    // No fee: (1000·10000)/(10000+1000) = 909.09…
    expect(getAmountOutV2(1000n, 10_000n, 10_000n, 0n)).toBe(909n);
    // 1%: (1000·0.99·10000)/(10000+990) = 900.8…
    expect(getAmountOutV2(1000n, 10_000n, 10_000n, 100n)).toBe(900n);
  });

  it("rejects a non-positive input and empty reserves", () => {
    expect(() => getAmountOutV2(0n, 10n, 10n)).toThrow(ValidationError);
    expect(() => getAmountOutV2(10n, 0n, 10n)).toThrow(/liquidity/);
    expect(() => getAmountOutV2(10n, 10n, 10n, 10_000n)).toThrow(/feeBps/);
  });
});

describe("priceImpactBps", () => {
  it("approaches the fee for a tiny trade on a deep pool", () => {
    const reserveIn = 1_000_000_000_000n;
    const reserveOut = 1_000_000_000_000n;
    const amountIn = 1_000_000n; // 0.0001% of the pool
    const amountOut = getAmountOutV2(amountIn, reserveIn, reserveOut);
    const impact = priceImpactBps(amountIn, amountOut, reserveIn, reserveOut);
    expect(impact).toBeGreaterThanOrEqual(30);
    expect(impact).toBeLessThanOrEqual(32);
  });

  it("grows with trade size", () => {
    const reserveIn = 1_000_000n;
    const reserveOut = 1_000_000n;
    const amountIn = 100_000n; // 10% of the pool
    const amountOut = getAmountOutV2(amountIn, reserveIn, reserveOut);
    const impact = priceImpactBps(amountIn, amountOut, reserveIn, reserveOut);
    expect(impact).toBeGreaterThan(900);
    expect(impact).toBeLessThan(1_100);
  });

  it("clamps into [0, 10000]", () => {
    expect(priceImpactBps(1n, 1_000_000n, 1n, 1n)).toBe(0);
    expect(priceImpactBps(1_000_000n, 0n, 1n, 1n)).toBe(10_000);
  });
});

describe("applySlippage", () => {
  it("computes the minimum output, rounding down", () => {
    expect(applySlippage(10_000n, 100)).toBe(9_900n); // 1%
    expect(applySlippage(3n, 1)).toBe(2n); // rounds down, never optimistic
    expect(applySlippage(10_000n, 0)).toBe(10_000n);
  });

  it("rejects out-of-range slippage and non-positive amounts", () => {
    expect(() => applySlippage(10_000n, -1)).toThrow(ValidationError);
    expect(() => applySlippage(10_000n, 10_000)).toThrow(ValidationError);
    expect(() => applySlippage(10_000n, 1.5)).toThrow(ValidationError);
    expect(() => applySlippage(0n, 100)).toThrow(ValidationError);
  });
});
