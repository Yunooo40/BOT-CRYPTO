import type { DexAdapter } from "@bot/dex-adapters";
import type { PriceSource } from "./ports";
import { PRICE_SCALE, type Price, type StrategyRule } from "./rules";

export interface QuotePriceSourceOptions {
  adapterFor: (rule: StrategyRule) => DexAdapter;
  /**
   * Notional token amount to price against, in base units. The price is the
   * sell quote of this amount, per token, scaled by PRICE_SCALE — matching what
   * the engine would realize (slippage included) for a trade of this size.
   * Default 1e18 (one whole token at 18 decimals).
   */
  notionalAmount?: bigint;
}

/**
 * Prices a token via a real sell quote (M3): quote `notionalAmount` of token →
 * quote-token out, expressed per token and scaled by PRICE_SCALE. This is the
 * realizable price, not a theoretical spot — the same number the engine gets.
 */
export class QuotePriceSource implements PriceSource {
  readonly #adapterFor: (rule: StrategyRule) => DexAdapter;
  readonly #notional: bigint;

  constructor(options: QuotePriceSourceOptions) {
    this.#adapterFor = options.adapterFor;
    this.#notional = options.notionalAmount ?? PRICE_SCALE;
  }

  async priceOf(rule: StrategyRule): Promise<Price | undefined> {
    try {
      const quote = await this.#adapterFor(rule).quoteExactIn({
        pool: rule.pool,
        tokenIn: rule.token,
        amountIn: this.#notional,
      });
      if (quote.amountOut === 0n) return undefined;
      // price = quoteOut per token, scaled: (out / notional) · SCALE.
      return (quote.amountOut * PRICE_SCALE) / this.#notional;
    } catch {
      // No liquidity, reverting quote, RPC down — price simply unavailable this
      // tick; the runner skips the rule rather than acting on a bad number.
      return undefined;
    }
  }
}
