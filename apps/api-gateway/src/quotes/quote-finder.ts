import {
  PoolNotFoundError,
  UNISWAP_V3_FEE_TIERS,
  type DexAdapter,
  type PoolQuery,
  type Quote,
} from "@bot/dex-adapters";
import type { Address, Dex } from "@bot/domain";

export interface BestQuoteParams {
  tokenIn: Address;
  tokenOut: Address;
  /** Exact input, base units of `tokenIn`. */
  amountIn: bigint;
  /** Restrict to one venue; omitted = best across all of them. */
  venue?: Dex;
}

/** Port between the controller and the DEX layer — e2e tests fake this. */
export interface QuoteFinder {
  /** @throws {PoolNotFoundError} when no venue has a pool for the pair. */
  bestQuote(params: BestQuoteParams): Promise<Quote>;
}

/**
 * Pool-query variants per venue: V2 has one canonical pool, V3 one per fee
 * tier, Aerodrome a volatile and a stable one. Every existing variant is
 * quoted and the largest output wins.
 */
function candidateQueries(dex: Dex, tokenA: Address, tokenB: Address): PoolQuery[] {
  switch (dex) {
    case "uniswap-v2":
      return [{ tokenA, tokenB }];
    case "uniswap-v3":
      return UNISWAP_V3_FEE_TIERS.map((feeTier) => ({ tokenA, tokenB, feeTier }));
    case "aerodrome":
      return [
        { tokenA, tokenB, stable: false },
        { tokenA, tokenB, stable: true },
      ];
  }
}

export class DexQuoteFinder implements QuoteFinder {
  constructor(private readonly adapters: Map<Dex, DexAdapter>) {}

  async bestQuote(params: BestQuoteParams): Promise<Quote> {
    const venues = [...this.adapters.entries()].filter(
      ([dex]) => params.venue === undefined || dex === params.venue,
    );

    const quotesPerVenue = await Promise.all(
      venues.map(async ([dex, adapter]) => {
        const pools = await Promise.all(
          candidateQueries(dex, params.tokenIn, params.tokenOut).map((query) =>
            adapter.getPool(query),
          ),
        );
        return Promise.all(
          pools
            .filter((pool) => pool !== undefined)
            .map((pool) =>
              adapter.quoteExactIn({ pool, tokenIn: params.tokenIn, amountIn: params.amountIn }),
            ),
        );
      }),
    );

    const quotes = quotesPerVenue.flat();
    const best = quotes.reduce<Quote | undefined>(
      (currentBest, quote) =>
        currentBest === undefined || quote.amountOut > currentBest.amountOut ? quote : currentBest,
      undefined,
    );
    if (best === undefined) {
      throw new PoolNotFoundError(
        `No pool for ${params.tokenIn}/${params.tokenOut} on ${params.venue ?? "any venue"}`,
        { context: { tokenIn: params.tokenIn, tokenOut: params.tokenOut, venue: params.venue } },
      );
    }
    return best;
  }
}
