import { toAddress, type Pool } from "@bot/domain";
import { decodeFunctionData } from "viem";
import { describe, expect, it, vi } from "vitest";
import { aerodromeRouterAbi } from "./abi";
import type { ChainReader } from "./adapter";
import { AerodromeAdapter } from "./aerodrome";
import { BASE_AERODROME } from "./addresses";

const WETH = toAddress("0x4200000000000000000000000000000000000006");
const USDC = toAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const POOL = toAddress("0xcdac0d6c6c59727a65f871236188350531885c43");
const RECIPIENT = toAddress("0x1234567890123456789012345678901234567890");

const volatilePool: Pool = {
  chainId: 8453,
  address: POOL,
  dex: "aerodrome",
  token0: WETH,
  token1: USDC,
  stable: false,
};

function makeAdapter() {
  const readContract = vi.fn();
  const adapter = new AerodromeAdapter({ client: { readContract } as unknown as ChainReader });
  return { adapter, readContract };
}

describe("AerodromeAdapter.getPool", () => {
  it("resolves stable and volatile pools separately", async () => {
    const { adapter, readContract } = makeAdapter();
    readContract.mockResolvedValueOnce(POOL);
    await expect(adapter.getPool({ tokenA: USDC, tokenB: WETH, stable: false })).resolves.toEqual(
      volatilePool,
    );
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: BASE_AERODROME.factory,
        functionName: "getPool",
        args: [WETH, USDC, false],
      }),
    );

    readContract.mockResolvedValueOnce("0x0000000000000000000000000000000000000000");
    await expect(
      adapter.getPool({ tokenA: WETH, tokenB: USDC, stable: true }),
    ).resolves.toBeUndefined();
  });
});

describe("AerodromeAdapter.quoteExactIn", () => {
  it("quotes a volatile pool via the router and computes impact from reserves", async () => {
    const { adapter, readContract } = makeAdapter();
    const reserve0 = 100n * 10n ** 18n;
    const reserve1 = 300_000n * 10n ** 6n;
    readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "getAmountsOut") {
        return Promise.resolve([10n ** 18n, 2_960n * 10n ** 6n]);
      }
      return Promise.resolve([reserve0, reserve1, 0n]);
    });
    const quote = await adapter.quoteExactIn({
      pool: volatilePool,
      tokenIn: WETH,
      amountIn: 10n ** 18n,
    });
    expect(quote.amountOut).toBe(2_960n * 10n ** 6n);
    expect(quote.tokenOut).toBe(USDC);
    expect(quote.priceImpactBps).toBeGreaterThan(0);
  });

  it("quotes a stable pool without pretending to know its spot price", async () => {
    const { adapter, readContract } = makeAdapter();
    readContract.mockResolvedValueOnce([10n ** 18n, 999n * 10n ** 6n]);
    const quote = await adapter.quoteExactIn({
      pool: { ...volatilePool, stable: true },
      tokenIn: WETH,
      amountIn: 10n ** 18n,
    });
    expect(quote.amountOut).toBe(999n * 10n ** 6n);
    expect(quote.priceImpactBps).toBeUndefined();
    // Exactly one call: getAmountsOut. No reserve read for a stable curve.
    expect(readContract).toHaveBeenCalledTimes(1);
  });
});

describe("AerodromeAdapter.buildSwapCalldata", () => {
  it("encodes the route with the pool's stable flag and this factory", () => {
    const { adapter } = makeAdapter();
    const call = adapter.buildSwapCalldata({
      pool: { ...volatilePool, stable: true },
      tokenIn: USDC,
      amountIn: 1_000n * 10n ** 6n,
      expectedAmountOut: 999n * 10n ** 6n,
      slippageBps: 100,
      recipient: RECIPIENT,
      deadline: 1_735_689_600n,
    });
    expect(call.to).toBe(BASE_AERODROME.router);
    expect(call.value).toBe(0n);

    const decoded = decodeFunctionData({ abi: aerodromeRouterAbi, data: call.data });
    expect(decoded.functionName).toBe("swapExactTokensForTokens");
    if (decoded.functionName !== "swapExactTokensForTokens") {
      return;
    }
    const [amountIn, amountOutMin, routes, to, deadline] = decoded.args;
    expect(amountIn).toBe(1_000n * 10n ** 6n);
    expect(amountOutMin).toBe((999n * 10n ** 6n * 9_900n) / 10_000n);
    expect(routes).toHaveLength(1);
    const route = routes[0];
    expect(route?.from.toLowerCase()).toBe(USDC);
    expect(route?.to.toLowerCase()).toBe(WETH);
    expect(route?.stable).toBe(true);
    expect(route?.factory.toLowerCase()).toBe(BASE_AERODROME.factory);
    expect(to.toLowerCase()).toBe(RECIPIENT);
    expect(deadline).toBe(1_735_689_600n);
  });
});
