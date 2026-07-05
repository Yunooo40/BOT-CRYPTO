import {
  PoolNotFoundError,
  UNISWAP_V3_FEE_TIERS,
  type DexAdapter,
  type PoolQuery,
  type Quote,
} from "@bot/dex-adapters";
import { poolSchema, toAddress, type Dex, type Pool } from "@bot/domain";
import { describe, expect, it } from "vitest";
import { DexQuoteFinder } from "./quote-finder";

const WETH = toAddress("0x4200000000000000000000000000000000000006");
const USDC = toAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");

function makePool(dex: Dex, extra: Partial<Pool> = {}): Pool {
  return poolSchema.parse({
    chainId: 8453,
    address: "0x00000000000000000000000000000000000000aa",
    dex,
    token0: USDC,
    token1: WETH,
    ...extra,
  });
}

/** Adapter stub: `getPool` answers from a matcher, quotes pay `amountOut`. */
function stubAdapter(
  dex: Dex,
  hasPool: (query: PoolQuery) => Pool | undefined,
  amountOut: bigint,
  seen: PoolQuery[] = [],
): DexAdapter {
  return {
    dex,
    async getPool(query) {
      seen.push(query);
      return hasPool(query);
    },
    async getPoolState() {
      throw new Error("not needed");
    },
    async quoteExactIn({ pool, tokenIn, amountIn }): Promise<Quote> {
      return { pool, tokenIn, tokenOut: WETH, amountIn, amountOut };
    },
    buildSwapCalldata() {
      throw new Error("not needed");
    },
  };
}

describe("DexQuoteFinder", () => {
  it("returns the largest output across venues and pool variants", async () => {
    const v3Queries: PoolQuery[] = [];
    const finder = new DexQuoteFinder(
      new Map<Dex, DexAdapter>([
        ["uniswap-v2", stubAdapter("uniswap-v2", () => makePool("uniswap-v2"), 100n)],
        [
          "uniswap-v3",
          stubAdapter(
            "uniswap-v3",
            (query) =>
              query.feeTier === 3000 ? makePool("uniswap-v3", { feeTier: 3000 }) : undefined,
            150n,
            v3Queries,
          ),
        ],
        ["aerodrome", stubAdapter("aerodrome", () => undefined, 999n)],
      ]),
    );

    const quote = await finder.bestQuote({ tokenIn: USDC, tokenOut: WETH, amountIn: 10n });
    expect(quote.amountOut).toBe(150n);
    expect(quote.pool.dex).toBe("uniswap-v3");
    // Every fee tier was probed.
    expect(v3Queries.map((query) => query.feeTier)).toEqual([...UNISWAP_V3_FEE_TIERS]);
  });

  it("restricts the search to the requested venue", async () => {
    const finder = new DexQuoteFinder(
      new Map<Dex, DexAdapter>([
        ["uniswap-v2", stubAdapter("uniswap-v2", () => makePool("uniswap-v2"), 100n)],
        ["uniswap-v3", stubAdapter("uniswap-v3", () => makePool("uniswap-v3"), 150n)],
      ]),
    );
    const quote = await finder.bestQuote({
      tokenIn: USDC,
      tokenOut: WETH,
      amountIn: 10n,
      venue: "uniswap-v2",
    });
    expect(quote.pool.dex).toBe("uniswap-v2");
    expect(quote.amountOut).toBe(100n);
  });

  it("probes both Aerodrome variants (volatile and stable)", async () => {
    const seen: PoolQuery[] = [];
    const finder = new DexQuoteFinder(
      new Map<Dex, DexAdapter>([
        ["aerodrome", stubAdapter("aerodrome", () => undefined, 0n, seen)],
      ]),
    );
    await expect(
      finder.bestQuote({ tokenIn: USDC, tokenOut: WETH, amountIn: 10n }),
    ).rejects.toBeInstanceOf(PoolNotFoundError);
    expect(seen.map((query) => query.stable)).toEqual([false, true]);
  });

  it("throws PoolNotFoundError when no venue has the pair", async () => {
    const finder = new DexQuoteFinder(
      new Map<Dex, DexAdapter>([["uniswap-v2", stubAdapter("uniswap-v2", () => undefined, 0n)]]),
    );
    await expect(
      finder.bestQuote({ tokenIn: USDC, tokenOut: WETH, amountIn: 10n }),
    ).rejects.toBeInstanceOf(PoolNotFoundError);
  });
});
