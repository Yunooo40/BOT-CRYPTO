import { toAddress, type Pool } from "@bot/domain";
import { ValidationError } from "@bot/errors";
import { decodeFunctionData } from "viem";
import { describe, expect, it, vi } from "vitest";
import { uniswapV2RouterAbi } from "./abi";
import type { ChainReader } from "./adapter";
import { BASE_UNISWAP_V2 } from "./addresses";
import { getAmountOutV2 } from "./math";
import { UniswapV2Adapter } from "./uniswap-v2";

const WETH = toAddress("0x4200000000000000000000000000000000000006");
const USDC = toAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const PAIR = toAddress("0x88a43bbdf9d098eec7bceda4e2494615dfd9bb9c");
const RECIPIENT = toAddress("0x1234567890123456789012345678901234567890");

const pool: Pool = { chainId: 8453, address: PAIR, dex: "uniswap-v2", token0: WETH, token1: USDC };

function makeAdapter() {
  const readContract = vi.fn();
  const adapter = new UniswapV2Adapter({ client: { readContract } as unknown as ChainReader });
  return { adapter, readContract };
}

describe("UniswapV2Adapter.getPool", () => {
  it("resolves the pair with sorted tokens", async () => {
    const { adapter, readContract } = makeAdapter();
    readContract.mockResolvedValueOnce(PAIR);
    // Query in reverse order: the adapter must sort before asking the factory.
    await expect(adapter.getPool({ tokenA: USDC, tokenB: WETH })).resolves.toEqual(pool);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: BASE_UNISWAP_V2.factory,
        functionName: "getPair",
        args: [WETH, USDC],
      }),
    );
  });

  it("returns undefined when the factory answers the zero address", async () => {
    const { adapter, readContract } = makeAdapter();
    readContract.mockResolvedValueOnce("0x0000000000000000000000000000000000000000");
    await expect(adapter.getPool({ tokenA: WETH, tokenB: USDC })).resolves.toBeUndefined();
  });
});

describe("UniswapV2Adapter.quoteExactIn", () => {
  const reserve0 = 100n * 10n ** 18n; // WETH
  const reserve1 = 300_000n * 10n ** 6n; // USDC

  it("quotes from reserves with local x·y=k math, both directions", async () => {
    const { adapter, readContract } = makeAdapter();
    readContract.mockResolvedValue([reserve0, reserve1, 0]);

    const amountIn = 10n ** 18n;
    const quote = await adapter.quoteExactIn({ pool, tokenIn: WETH, amountIn });
    expect(quote.amountOut).toBe(getAmountOutV2(amountIn, reserve0, reserve1));
    expect(quote.tokenOut).toBe(USDC);
    expect(quote.priceImpactBps).toBeGreaterThanOrEqual(30);

    const back = await adapter.quoteExactIn({ pool, tokenIn: USDC, amountIn: 3_000n * 10n ** 6n });
    expect(back.amountOut).toBe(getAmountOutV2(3_000n * 10n ** 6n, reserve1, reserve0));
    expect(back.tokenOut).toBe(WETH);
  });

  it("rejects a tokenIn that is not in the pool", async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.quoteExactIn({ pool, tokenIn: RECIPIENT, amountIn: 1n })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("UniswapV2Adapter.buildSwapCalldata", () => {
  it("encodes swapExactTokensForTokens with the slippage guard", () => {
    const { adapter } = makeAdapter();
    const call = adapter.buildSwapCalldata({
      pool,
      tokenIn: WETH,
      amountIn: 10n ** 18n,
      expectedAmountOut: 3_000n * 10n ** 6n,
      slippageBps: 100,
      recipient: RECIPIENT,
      deadline: 1_735_689_600n,
    });
    expect(call.to).toBe(BASE_UNISWAP_V2.router);
    expect(call.value).toBe(0n);

    const decoded = decodeFunctionData({ abi: uniswapV2RouterAbi, data: call.data });
    expect(decoded.functionName).toBe("swapExactTokensForTokens");
    const [amountIn, amountOutMin, path, to, deadline] = decoded.args;
    expect(amountIn).toBe(10n ** 18n);
    expect(amountOutMin).toBe(2_970n * 10n ** 6n); // 1% below expectation
    expect(path.map((address) => address.toLowerCase())).toEqual([WETH, USDC]);
    expect(to.toLowerCase()).toBe(RECIPIENT);
    expect(deadline).toBe(1_735_689_600n);
  });

  it("rejects a pool from another venue", () => {
    const { adapter } = makeAdapter();
    expect(() =>
      adapter.buildSwapCalldata({
        pool: { ...pool, dex: "aerodrome" },
        tokenIn: WETH,
        amountIn: 1n,
        expectedAmountOut: 1n,
        slippageBps: 0,
        recipient: RECIPIENT,
        deadline: 0n,
      }),
    ).toThrow(ValidationError);
  });
});
