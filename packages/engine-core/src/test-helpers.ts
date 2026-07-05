import type { DexAdapter, Quote } from "@bot/dex-adapters";
import { tokenAmount, toAddress, type Pool, type TradeIntent } from "@bot/domain";
import { vi } from "vitest";
import type { Router } from "./ports";

export const WETH = toAddress("0x4200000000000000000000000000000000000006");
export const MEME = toAddress("0x9999999999999999999999999999999999999999");
export const POOL_ADDR = toAddress("0x1111111111111111111111111111111111111111");
export const TRADER = toAddress("0x2222222222222222222222222222222222222222");
export const ROUTER_ADDR = toAddress("0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24");

export const pool: Pool = {
  chainId: 8453,
  address: POOL_ADDR,
  dex: "uniswap-v2",
  token0: WETH,
  token1: MEME,
};

export function buyIntent(overrides: Partial<TradeIntent> = {}): TradeIntent {
  return {
    chainId: 8453,
    side: "buy",
    token: MEME,
    amountIn: tokenAmount(10n ** 18n, 18),
    maxSlippageBps: 100,
    simulated: false,
    ...overrides,
  };
}

export function sellIntent(overrides: Partial<TradeIntent> = {}): TradeIntent {
  return buyIntent({ side: "sell", ...overrides });
}

/** A router whose single adapter returns a fixed quote and canned calldata. */
export function stubRouter(amountOut: bigint): { router: Router; adapter: DexAdapter } {
  const quote: Quote = {
    pool,
    tokenIn: WETH,
    tokenOut: MEME,
    amountIn: 10n ** 18n,
    amountOut,
  };
  const adapter = {
    dex: "uniswap-v2",
    getPool: vi.fn(),
    getPoolState: vi.fn(),
    quoteExactIn: vi.fn(async () => quote),
    buildSwapCalldata: vi.fn(() => ({ to: ROUTER_ADDR, data: "0xdeadbeef" as const, value: 0n })),
  } as unknown as DexAdapter;
  return { router: { adapterFor: () => adapter }, adapter };
}
