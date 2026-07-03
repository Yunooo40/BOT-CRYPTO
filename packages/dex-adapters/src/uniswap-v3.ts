import { SUPPORTED_CHAINS, type ChainId, type Dex, type Pool } from "@bot/domain";
import { ValidationError } from "@bot/errors";
import { encodeFunctionData } from "viem";
import {
  uniswapV3FactoryAbi,
  uniswapV3PoolAbi,
  uniswapV3QuoterV2Abi,
  uniswapV3RouterAbi,
} from "./abi";
import {
  asHex,
  assertVenue,
  counterToken,
  nonZeroAddress,
  sortTokens,
  type ChainReader,
  type DexAdapter,
  type PoolQuery,
  type PoolState,
  type Quote,
  type QuoteExactInParams,
  type SwapCall,
  type SwapCalldataParams,
} from "./adapter";
import { BASE_UNISWAP_V3, type UniswapV3Addresses } from "./addresses";
import { applySlippage } from "./math";

/** The fee tiers Uniswap V3 deploys by default, in hundredths of a bip. */
export const UNISWAP_V3_FEE_TIERS = [100, 500, 3_000, 10_000] as const;

export interface UniswapV3AdapterOptions {
  client: ChainReader;
  addresses?: UniswapV3Addresses;
  chainId?: ChainId;
}

function requireFeeTier(pool: Pool): number {
  if (pool.feeTier === undefined) {
    throw new ValidationError("A Uniswap V3 pool needs a feeTier", {
      context: { pool: pool.address },
    });
  }
  return pool.feeTier;
}

export class UniswapV3Adapter implements DexAdapter {
  readonly dex: Dex = "uniswap-v3";

  readonly #client: ChainReader;
  readonly #addresses: UniswapV3Addresses;
  readonly #chainId: ChainId;

  constructor(options: UniswapV3AdapterOptions) {
    this.#client = options.client;
    this.#addresses = options.addresses ?? BASE_UNISWAP_V3;
    this.#chainId = options.chainId ?? SUPPORTED_CHAINS.base;
  }

  async getPool(query: PoolQuery): Promise<Pool | undefined> {
    const feeTier = query.feeTier;
    if (feeTier === undefined) {
      throw new ValidationError("Uniswap V3 getPool needs a feeTier", { context: { query } });
    }
    const [token0, token1] = sortTokens(query.tokenA, query.tokenB);
    const poolAddress = await this.#client.readContract({
      address: asHex(this.#addresses.factory),
      abi: uniswapV3FactoryAbi,
      functionName: "getPool",
      args: [asHex(token0), asHex(token1), feeTier],
    });
    const address = nonZeroAddress(poolAddress);
    if (address === undefined) {
      return undefined;
    }
    return { chainId: this.#chainId, address, dex: this.dex, token0, token1, feeTier };
  }

  async getPoolState(pool: Pool): Promise<PoolState> {
    assertVenue(pool, this.dex);
    const [slot0, liquidity] = await Promise.all([
      this.#client.readContract({
        address: asHex(pool.address),
        abi: uniswapV3PoolAbi,
        functionName: "slot0",
      }),
      this.#client.readContract({
        address: asHex(pool.address),
        abi: uniswapV3PoolAbi,
        functionName: "liquidity",
      }),
    ]);
    const [sqrtPriceX96, tick] = slot0;
    return { kind: "v3", liquidity, sqrtPriceX96, tick };
  }

  async quoteExactIn(params: QuoteExactInParams): Promise<Quote> {
    const { pool, tokenIn, amountIn } = params;
    assertVenue(pool, this.dex);
    if (amountIn <= 0n) {
      throw new ValidationError("amountIn must be positive", {
        context: { amountIn: amountIn.toString() },
      });
    }
    const tokenOut = counterToken(pool, tokenIn);
    const fee = requireFeeTier(pool);
    const [amountOut] = await this.#client.readContract({
      address: asHex(this.#addresses.quoter),
      abi: uniswapV3QuoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn: asHex(tokenIn),
          tokenOut: asHex(tokenOut),
          amountIn,
          fee,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    return { pool, tokenIn, tokenOut, amountIn, amountOut };
  }

  buildSwapCalldata(params: SwapCalldataParams): SwapCall {
    const { pool, tokenIn, amountIn, expectedAmountOut, slippageBps, recipient, deadline } = params;
    assertVenue(pool, this.dex);
    const tokenOut = counterToken(pool, tokenIn);
    const fee = requireFeeTier(pool);
    const amountOutMinimum = applySlippage(expectedAmountOut, slippageBps);
    const swap = encodeFunctionData({
      abi: uniswapV3RouterAbi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: asHex(tokenIn),
          tokenOut: asHex(tokenOut),
          fee,
          recipient: asHex(recipient),
          amountIn,
          amountOutMinimum,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    // SwapRouter02 dropped the per-call deadline; it lives on the multicall.
    const data = encodeFunctionData({
      abi: uniswapV3RouterAbi,
      functionName: "multicall",
      args: [deadline, [swap]],
    });
    return { to: this.#addresses.router, data, value: 0n };
  }
}
