import { SUPPORTED_CHAINS, type ChainId, type Dex, type Pool } from "@bot/domain";
import { ValidationError } from "@bot/errors";
import { encodeFunctionData } from "viem";
import { aerodromeFactoryAbi, aerodromePoolAbi, aerodromeRouterAbi } from "./abi";
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
import { BASE_AERODROME, type AerodromeAddresses } from "./addresses";
import { applySlippage, priceImpactBps } from "./math";

export interface AerodromeAdapterOptions {
  client: ChainReader;
  addresses?: AerodromeAddresses;
  chainId?: ChainId;
}

/**
 * Aerodrome (Solidly-style): every pool is stable (x³y+xy³) or volatile (xy=k),
 * with per-pool fees set by the factory. Quotes therefore go through the
 * router's `getAmountsOut` — one eth_call, exact for both curves — instead of
 * reimplementing the stable-swap math locally.
 */
export class AerodromeAdapter implements DexAdapter {
  readonly dex: Dex = "aerodrome";

  readonly #client: ChainReader;
  readonly #addresses: AerodromeAddresses;
  readonly #chainId: ChainId;

  constructor(options: AerodromeAdapterOptions) {
    this.#client = options.client;
    this.#addresses = options.addresses ?? BASE_AERODROME;
    this.#chainId = options.chainId ?? SUPPORTED_CHAINS.base;
  }

  async getPool(query: PoolQuery): Promise<Pool | undefined> {
    const stable = query.stable ?? false;
    const [token0, token1] = sortTokens(query.tokenA, query.tokenB);
    const poolAddress = await this.#client.readContract({
      address: asHex(this.#addresses.factory),
      abi: aerodromeFactoryAbi,
      functionName: "getPool",
      args: [asHex(token0), asHex(token1), stable],
    });
    const address = nonZeroAddress(poolAddress);
    if (address === undefined) {
      return undefined;
    }
    return { chainId: this.#chainId, address, dex: this.dex, token0, token1, stable };
  }

  async getPoolState(pool: Pool): Promise<PoolState> {
    assertVenue(pool, this.dex);
    const [reserve0, reserve1] = await this.#client.readContract({
      address: asHex(pool.address),
      abi: aerodromePoolAbi,
      functionName: "getReserves",
    });
    return { kind: "v2", reserve0, reserve1 };
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
    const amounts = await this.#client.readContract({
      address: asHex(this.#addresses.router),
      abi: aerodromeRouterAbi,
      functionName: "getAmountsOut",
      args: [amountIn, [this.#route(pool, tokenIn, tokenOut)]],
    });
    const amountOut = amounts[amounts.length - 1];
    if (amountOut === undefined) {
      throw new ValidationError("Aerodrome router returned no amounts", {
        context: { pool: pool.address },
      });
    }
    const quote: Quote = { pool, tokenIn, tokenOut, amountIn, amountOut };
    // Spot price from reserves only means something on the xy=k curve.
    if (pool.stable !== true) {
      const state = await this.getPoolState(pool);
      if (state.kind === "v2") {
        const [reserveIn, reserveOut] =
          tokenIn === pool.token0
            ? [state.reserve0, state.reserve1]
            : [state.reserve1, state.reserve0];
        quote.priceImpactBps = priceImpactBps(amountIn, amountOut, reserveIn, reserveOut);
      }
    }
    return quote;
  }

  buildSwapCalldata(params: SwapCalldataParams): SwapCall {
    const { pool, tokenIn, amountIn, expectedAmountOut, slippageBps, recipient, deadline } = params;
    assertVenue(pool, this.dex);
    const tokenOut = counterToken(pool, tokenIn);
    const amountOutMin = applySlippage(expectedAmountOut, slippageBps);
    const data = encodeFunctionData({
      abi: aerodromeRouterAbi,
      functionName: "swapExactTokensForTokens",
      args: [
        amountIn,
        amountOutMin,
        [this.#route(pool, tokenIn, tokenOut)],
        asHex(recipient),
        deadline,
      ],
    });
    return { to: this.#addresses.router, data, value: 0n };
  }

  #route(pool: Pool, tokenIn: Pool["token0"], tokenOut: Pool["token0"]) {
    return {
      from: asHex(tokenIn),
      to: asHex(tokenOut),
      stable: pool.stable ?? false,
      factory: asHex(this.#addresses.factory),
    };
  }
}
