import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { describe, expect, it } from "vitest";
import { requirePool, type DexAdapter } from "./adapter";
import { BASE_USDC, BASE_WETH } from "./addresses";
import { createDexAdapters } from "./registry";

/**
 * Integration tests against a real Base state: an anvil fork
 * (`anvil --fork-url ...`) or any live Base RPC. Read-only. Opt-in:
 *
 *   BASE_FORK_RPC_URL=http://127.0.0.1:8545 pnpm --filter @bot/dex-adapters test
 *
 * Skipped entirely when BASE_FORK_RPC_URL is not set (local dev, CI).
 */
const FORK_URL = process.env["BASE_FORK_RPC_URL"];

const NETWORK_TIMEOUT = 30_000;

describe.skipIf(FORK_URL === undefined || FORK_URL === "")(
  "dex adapters against real Base state",
  () => {
    const client = createPublicClient({
      chain: base,
      transport: http(FORK_URL ?? "", { timeout: 20_000 }),
    });
    const adapters = createDexAdapters(client);
    const oneWeth = 10n ** 18n;

    // WETH/USDC price sanity window, USDC has 6 decimals: 100 – 100 000 USDC/ETH.
    const plausible = (amountOut: bigint) =>
      amountOut > 100n * 10n ** 6n && amountOut < 100_000n * 10n ** 6n;

    async function resolveAndQuote(
      adapter: DexAdapter,
      query: Parameters<DexAdapter["getPool"]>[0],
    ) {
      const pool = await requirePool(adapter, query);
      expect(pool.address).toMatch(/^0x[0-9a-f]{40}$/);
      const quote = await adapter.quoteExactIn({ pool, tokenIn: BASE_WETH, amountIn: oneWeth });
      expect(plausible(quote.amountOut)).toBe(true);
      return quote;
    }

    it(
      "uniswap-v3: resolves WETH/USDC (500) and quotes 1 WETH plausibly",
      async () => {
        const adapter = adapters.get("uniswap-v3");
        expect(adapter).toBeDefined();
        await resolveAndQuote(adapter as DexAdapter, {
          tokenA: BASE_WETH,
          tokenB: BASE_USDC,
          feeTier: 500,
        });
      },
      NETWORK_TIMEOUT,
    );

    it(
      "uniswap-v2: resolves WETH/USDC and quotes 1 WETH plausibly",
      async () => {
        const adapter = adapters.get("uniswap-v2");
        expect(adapter).toBeDefined();
        const quote = await resolveAndQuote(adapter as DexAdapter, {
          tokenA: BASE_WETH,
          tokenB: BASE_USDC,
        });
        expect(quote.priceImpactBps).toBeGreaterThan(0);
      },
      NETWORK_TIMEOUT,
    );

    it(
      "aerodrome: resolves volatile WETH/USDC and quotes 1 WETH plausibly",
      async () => {
        const adapter = adapters.get("aerodrome");
        expect(adapter).toBeDefined();
        await resolveAndQuote(adapter as DexAdapter, {
          tokenA: BASE_WETH,
          tokenB: BASE_USDC,
          stable: false,
        });
      },
      NETWORK_TIMEOUT,
    );
  },
);
