import { ValidationError } from "@bot/errors";

export const BPS_DENOMINATOR = 10_000n;

/**
 * Uniswap V2 constant-product output: `x·y = k` with the fee taken on input.
 * `feeBps` is the LP fee in basis points (30 = the classic 0.3%).
 */
export function getAmountOutV2(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps = 30n,
): bigint {
  if (amountIn <= 0n) {
    throw new ValidationError("amountIn must be positive", {
      context: { amountIn: amountIn.toString() },
    });
  }
  if (reserveIn <= 0n || reserveOut <= 0n) {
    throw new ValidationError("Pool has no liquidity", {
      context: { reserveIn: reserveIn.toString(), reserveOut: reserveOut.toString() },
    });
  }
  if (feeBps < 0n || feeBps >= BPS_DENOMINATOR) {
    throw new ValidationError("feeBps must be in [0, 10000)", {
      context: { feeBps: feeBps.toString() },
    });
  }
  const amountInWithFee = amountIn * (BPS_DENOMINATOR - feeBps);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * BPS_DENOMINATOR + amountInWithFee;
  return numerator / denominator;
}

/**
 * Execution price vs spot (reserve ratio), in basis points, fee included.
 * 0 = traded at spot; 10000 = received nothing. Clamped to [0, 10000].
 */
export function priceImpactBps(
  amountIn: bigint,
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): number {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    throw new ValidationError("priceImpactBps needs positive amountIn and reserves", {
      context: { amountIn: amountIn.toString() },
    });
  }
  const executedVsSpot = (amountOut * reserveIn * BPS_DENOMINATOR) / (amountIn * reserveOut);
  const impact = BPS_DENOMINATOR - executedVsSpot;
  const clamped = impact < 0n ? 0n : impact > BPS_DENOMINATOR ? BPS_DENOMINATOR : impact;
  return Number(clamped);
}

/**
 * The slippage guard: minimum acceptable output given an expected quote.
 * Rounds down — the guard must never be more optimistic than the quote.
 */
export function applySlippage(expectedAmountOut: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) {
    throw new ValidationError("slippageBps must be an integer in [0, 10000)", {
      context: { slippageBps },
    });
  }
  if (expectedAmountOut <= 0n) {
    throw new ValidationError("expectedAmountOut must be positive", {
      context: { expectedAmountOut: expectedAmountOut.toString() },
    });
  }
  return (expectedAmountOut * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR;
}
