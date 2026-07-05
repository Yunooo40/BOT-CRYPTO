import { counterToken, type DexAdapter, type Quote } from "@bot/dex-adapters";
import { tokenAmount, type Pool, type TradeIntent } from "@bot/domain";
import { SlippageError } from "./errors";

/**
 * Resolve `tokenIn` for an intent: a buy spends the pool's *other* token (the
 * quote asset, e.g. WETH) to get `intent.token`; a sell spends `intent.token`.
 */
export function tokenInFor(intent: TradeIntent, pool: Pool) {
  return intent.side === "buy" ? counterToken(pool, intent.token) : intent.token;
}

/** Quote the intent against its pool. Shared by both executors. */
export async function quoteIntent(
  adapter: DexAdapter,
  intent: TradeIntent,
  pool: Pool,
): Promise<Quote> {
  return adapter.quoteExactIn({
    pool,
    tokenIn: tokenInFor(intent, pool),
    amountIn: intent.amountIn.raw,
  });
}

/** amountOutMin from a quote and the intent's slippage tolerance (rounds down). */
export function minOut(quote: Quote, maxSlippageBps: number): bigint {
  return (quote.amountOut * BigInt(10_000 - maxSlippageBps)) / 10_000n;
}

/** Guard a realized output against the slippage floor. */
export function assertWithinSlippage(realized: bigint, floor: bigint, token: string): void {
  if (realized < floor) {
    throw new SlippageError("Realized output below slippage floor", {
      context: { token, realized: realized.toString(), floor: floor.toString() },
    });
  }
}

/** Zero-decimals wrapper: the engine tracks raw base units, decimals live upstream. */
export function raw(amount: bigint) {
  return tokenAmount(amount, 0);
}
