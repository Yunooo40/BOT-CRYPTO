import { toAddress, type Pool } from "@bot/domain";
import { ValidationError } from "@bot/errors";
import { decodeFunctionData } from "viem";
import { describe, expect, it, vi } from "vitest";
import { uniswapV3RouterAbi } from "./abi";
import type { ChainReader } from "./adapter";
import { BASE_UNISWAP_V3 } from "./addresses";
import { UniswapV3Adapter } from "./uniswap-v3";

const WETH = toAddress("0x4200000000000000000000000000000000000006");
const USDC = toAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const POOL = toAddress("0xd0b53d9277642d899df5c87a3966a349a798f224");
const RECIPIENT = toAddress("0x1234567890123456789012345678901234567890");

const pool: Pool = {
  chainId: 8453,
  address: POOL,
  dex: "uniswap-v3",
  token0: WETH,
  token1: USDC,
  feeTier: 500,
};

function makeAdapter() {
  const readContract = vi.fn();
  const adapter = new UniswapV3Adapter({ client: { readContract } as unknown as ChainReader });
  return { adapter, readContract };
}

describe("UniswapV3Adapter.getPool", () => {
  it("requires a feeTier", async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.getPool({ tokenA: WETH, tokenB: USDC })).rejects.toThrow(ValidationError);
  });

  it("resolves the pool for a fee tier, sorted tokens", async () => {
    const { adapter, readContract } = makeAdapter();
    readContract.mockResolvedValueOnce(POOL);
    await expect(adapter.getPool({ tokenA: USDC, tokenB: WETH, feeTier: 500 })).resolves.toEqual(
      pool,
    );
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: BASE_UNISWAP_V3.factory,
        functionName: "getPool",
        args: [WETH, USDC, 500],
      }),
    );
  });

  it("returns undefined for a non-existent tier", async () => {
    const { adapter, readContract } = makeAdapter();
    readContract.mockResolvedValueOnce("0x0000000000000000000000000000000000000000");
    await expect(
      adapter.getPool({ tokenA: WETH, tokenB: USDC, feeTier: 100 }),
    ).resolves.toBeUndefined();
  });
});

describe("UniswapV3Adapter.getPoolState", () => {
  it("reads slot0 and liquidity", async () => {
    const { adapter, readContract } = makeAdapter();
    const sqrtPriceX96 = 2n ** 96n;
    readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "slot0") {
        return Promise.resolve([sqrtPriceX96, -100, 0, 0, 0, 0, true]);
      }
      return Promise.resolve(123_456n);
    });
    await expect(adapter.getPoolState(pool)).resolves.toEqual({
      kind: "v3",
      sqrtPriceX96,
      tick: -100,
      liquidity: 123_456n,
    });
  });
});

describe("UniswapV3Adapter.quoteExactIn", () => {
  it("quotes through QuoterV2", async () => {
    const { adapter, readContract } = makeAdapter();
    readContract.mockResolvedValueOnce([3_000n * 10n ** 6n, 0n, 1, 60_000n]);
    const quote = await adapter.quoteExactIn({ pool, tokenIn: WETH, amountIn: 10n ** 18n });
    expect(quote.amountOut).toBe(3_000n * 10n ** 6n);
    expect(quote.tokenOut).toBe(USDC);
    expect(quote.priceImpactBps).toBeUndefined();
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: BASE_UNISWAP_V3.quoter,
        functionName: "quoteExactInputSingle",
        args: [expect.objectContaining({ tokenIn: WETH, tokenOut: USDC, fee: 500 })],
      }),
    );
  });

  it("rejects a pool without feeTier and a non-positive amount", async () => {
    const { adapter } = makeAdapter();
    const bare: Pool = { ...pool };
    delete bare.feeTier;
    await expect(adapter.quoteExactIn({ pool: bare, tokenIn: WETH, amountIn: 1n })).rejects.toThrow(
      /feeTier/,
    );
    await expect(adapter.quoteExactIn({ pool, tokenIn: WETH, amountIn: 0n })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("UniswapV3Adapter.buildSwapCalldata", () => {
  it("wraps exactInputSingle in a deadline-carrying multicall", () => {
    const { adapter } = makeAdapter();
    const call = adapter.buildSwapCalldata({
      pool,
      tokenIn: WETH,
      amountIn: 10n ** 18n,
      expectedAmountOut: 3_000n * 10n ** 6n,
      slippageBps: 50,
      recipient: RECIPIENT,
      deadline: 1_735_689_600n,
    });
    expect(call.to).toBe(BASE_UNISWAP_V3.router);
    expect(call.value).toBe(0n);

    const outer = decodeFunctionData({ abi: uniswapV3RouterAbi, data: call.data });
    expect(outer.functionName).toBe("multicall");
    if (outer.functionName !== "multicall") {
      return;
    }
    const [deadline, calls] = outer.args;
    expect(deadline).toBe(1_735_689_600n);
    expect(calls).toHaveLength(1);

    const inner = decodeFunctionData({ abi: uniswapV3RouterAbi, data: calls[0] as `0x${string}` });
    expect(inner.functionName).toBe("exactInputSingle");
    if (inner.functionName !== "exactInputSingle") {
      return;
    }
    const [params] = inner.args;
    expect(params.tokenIn.toLowerCase()).toBe(WETH);
    expect(params.tokenOut.toLowerCase()).toBe(USDC);
    expect(params.fee).toBe(500);
    expect(params.recipient.toLowerCase()).toBe(RECIPIENT);
    expect(params.amountIn).toBe(10n ** 18n);
    expect(params.amountOutMinimum).toBe(2_985n * 10n ** 6n); // 0.5% below expectation
    expect(params.sqrtPriceLimitX96).toBe(0n);
  });
});
