import { SUPPORTED_CHAINS, type ChainId, type Dex, type Pool } from "@bot/domain";
import { ValidationError } from "@bot/errors";
import { encodeFunctionData } from "viem";
import { uniswapV2FactoryAbi, uniswapV2PairAbi, uniswapV2RouterAbi } from "./abi";
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
import { BASE_UNISWAP_V2, type UniswapV2Addresses } from "./addresses";
import { applySlippage, getAmountOutV2, priceImpactBps } from "./math";

export interface UniswapV2AdapterOptions {
  client: ChainReader;
  addresses?: UniswapV2Addresses;
  chainId?: ChainId;
  /** LP fee in basis points. Uniswap V2 is a protocol constant: 30. */
  feeBps?: bigint;
}

export class UniswapV2Adapter implements DexAdapter {
  readonly dex: Dex = "uniswap-v2";

  readonly #client: ChainReader;
  readonly #addresses: UniswapV2Addresses;
  readonly #chainId: ChainId;
  readonly #feeBps: bigint;

  constructor(options: UniswapV2AdapterOptions) {
    this.#client = options.client;
    this.#addresses = options.addresses ?? BASE_UNISWAP_V2;
    this.#chainId = options.chainId ?? SUPPORTED_CHAINS.base;
    this.#feeBps = options.feeBps ?? 30n;
  }

  async getPool(query: PoolQuery): Promise<Pool | undefined> {
    const [token0, token1] = sortTokens(query.tokenA, query.tokenB);
    const pair = await this.#client.readContract({
      address: asHex(this.#addresses.factory),
      abi: uniswapV2FactoryAbi,
      functionName: "getPair",
      args: [asHex(token0), asHex(token1)],
    });
    const address = nonZeroAddress(pair);
    if (address === undefined) {
      return undefined;
    }
    return { chainId: this.#chainId, address, dex: this.dex, token0, token1 };
  }

  async getPoolState(pool: Pool): Promise<PoolState> {
    assertVenue(pool, this.dex);
    const [reserve0, reserve1] = await this.#client.readContract({
      address: asHex(pool.address),
      abi: uniswapV2PairAbi,
      functionName: "getReserves",
    });
    return { kind: "v2", reserve0, reserve1 };
  }

  async quoteExactIn(params: QuoteExactInParams): Promise<Quote> {
    const { pool, tokenIn, amountIn } = params;
    const tokenOut = counterToken(pool, tokenIn);
    const state = await this.getPoolState(pool);
    if (state.kind !== "v2") {
      // Unreachable: this adapter's getPoolState always returns "v2".
      throw new ValidationError("Unexpected pool state shape", { context: { pool } });
    }
    const [reserveIn, reserveOut] =
      tokenIn === pool.token0 ? [state.reserve0, state.reserve1] : [state.reserve1, state.reserve0];
    const amountOut = getAmountOutV2(amountIn, reserveIn, reserveOut, this.#feeBps);
    return {
      pool,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      priceImpactBps: priceImpactBps(amountIn, amountOut, reserveIn, reserveOut),
    };
  }

  buildSwapCalldata(params: SwapCalldataParams): SwapCall {
    const { pool, tokenIn, amountIn, expectedAmountOut, slippageBps, recipient, deadline } = params;
    assertVenue(pool, this.dex);
    const tokenOut = counterToken(pool, tokenIn);
    const amountOutMin = applySlippage(expectedAmountOut, slippageBps);
    const data = encodeFunctionData({
      abi: uniswapV2RouterAbi,
      functionName: "swapExactTokensForTokens",
      args: [amountIn, amountOutMin, [asHex(tokenIn), asHex(tokenOut)], asHex(recipient), deadline],
    });
    return { to: this.#addresses.router, data, value: 0n };
  }
}
