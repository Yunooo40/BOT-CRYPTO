import { ValidationError } from "@bot/errors";
import { PoolNotFoundError } from "./errors";
import { toAddress, type Address, type Dex, type Pool } from "@bot/domain";
import type { Address as ViemAddress, PublicClient } from "viem";

/**
 * The chain-reading surface the adapters need. Structurally satisfied by any
 * viem `PublicClient` — including the virtual client of `@bot/rpc-manager` —
 * without this package depending on the pool implementation.
 */
export type ChainReader = Pick<PublicClient, "readContract">;

/** Which pool to resolve. Venue-specific knobs are optional. */
export interface PoolQuery {
  tokenA: Address;
  tokenB: Address;
  /** Uniswap V3: fee tier in hundredths of a bip (500, 3000, 10000). */
  feeTier?: number;
  /** Aerodrome: stable vs volatile pool. Defaults to volatile. */
  stable?: boolean;
}

/** Raw pool state. Amounts are base units — decimals belong to the Token layer. */
export type PoolState =
  | { kind: "v2"; reserve0: bigint; reserve1: bigint }
  | { kind: "v3"; liquidity: bigint; sqrtPriceX96: bigint; tick: number };

export interface QuoteExactInParams {
  pool: Pool;
  tokenIn: Address;
  /** Exact input, in base units of `tokenIn`. */
  amountIn: bigint;
}

export interface Quote {
  pool: Pool;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  /**
   * Execution price vs spot, in basis points, fee included. Only present when
   * computable locally from reserves (V2-style pools); V3 and Aerodrome stable
   * quotes come from on-chain quoters that don't expose the spot price.
   */
  priceImpactBps?: number;
}

export interface SwapCalldataParams {
  pool: Pool;
  tokenIn: Address;
  /** Exact input, in base units of `tokenIn`. */
  amountIn: bigint;
  /** The quote's output — baseline for the slippage guard. */
  expectedAmountOut: bigint;
  /** Max acceptable slippage vs `expectedAmountOut`, in basis points. */
  slippageBps: number;
  recipient: Address;
  /** Unix timestamp (seconds) after which the swap reverts. */
  deadline: bigint;
}

/** A ready-to-sign call. ERC-20 → ERC-20 only, so `value` is always 0n in M3. */
export interface SwapCall {
  to: Address;
  data: `0x${string}`;
  value: bigint;
}

/**
 * One DEX venue: pool resolution, state, quotes, swap calldata. Read-only —
 * signing and sending belong to the Wallet Service (M4) and Engine (M7).
 */
export interface DexAdapter {
  readonly dex: Dex;
  /** Resolve the pool for a pair, or `undefined` if the venue doesn't have it. */
  getPool(query: PoolQuery): Promise<Pool | undefined>;
  /** Raw on-chain state of a pool previously resolved by this adapter. */
  getPoolState(pool: Pool): Promise<PoolState>;
  /** Expected output for an exact input. Token-level taxes are NOT modeled. */
  quoteExactIn(params: QuoteExactInParams): Promise<Quote>;
  /** ABI-encoded swap call with slippage guard and deadline. Pure — no I/O. */
  buildSwapCalldata(params: SwapCalldataParams): SwapCall;
}

/**
 * Resolve a pool that is expected to exist — e.g. before quoting a snipe.
 * @throws {PoolNotFoundError} when the venue has no such pool.
 */
export async function requirePool(adapter: DexAdapter, query: PoolQuery): Promise<Pool> {
  const pool = await adapter.getPool(query);
  if (pool === undefined) {
    throw new PoolNotFoundError(`No ${adapter.dex} pool for ${query.tokenA}/${query.tokenB}`, {
      context: { dex: adapter.dex, ...query },
    });
  }
  return pool;
}

/** Domain `Address` (branded lowercase string) → viem's `0x${string}`. */
export function asHex(address: Address): ViemAddress {
  return address as unknown as ViemAddress;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Map a factory answer to a domain Address, or `undefined` for "no pool". */
export function nonZeroAddress(value: string): Address | undefined {
  const address = toAddress(value);
  return address === ZERO_ADDRESS ? undefined : address;
}

/** Uniswap-style canonical token ordering: token0 is the lower address. */
export function sortTokens(tokenA: Address, tokenB: Address): [Address, Address] {
  if (tokenA === tokenB) {
    throw new ValidationError("A pool needs two distinct tokens", {
      context: { tokenA, tokenB },
    });
  }
  return tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];
}

/**
 * Given `tokenIn`, return the pool's other token — or throw if `tokenIn`
 * isn't part of the pool (a mixed-up pool/token pair must never trade).
 */
export function counterToken(pool: Pool, tokenIn: Address): Address {
  if (tokenIn === pool.token0) {
    return pool.token1;
  }
  if (tokenIn === pool.token1) {
    return pool.token0;
  }
  throw new ValidationError("tokenIn is not part of the pool", {
    context: { tokenIn, pool: pool.address, token0: pool.token0, token1: pool.token1 },
  });
}

/** Ensure the pool belongs to this adapter's venue before acting on it. */
export function assertVenue(pool: Pool, dex: Dex): void {
  if (pool.dex !== dex) {
    throw new ValidationError(`Pool belongs to ${pool.dex}, not ${dex}`, {
      context: { pool: pool.address, expected: dex, actual: pool.dex },
    });
  }
}
