import { toAddress, type Pool } from "@bot/domain";
import { PRICE_SCALE, type StrategyParams, type StrategyRule, type StrategyState } from "./rules";

export const WETH = toAddress("0x4200000000000000000000000000000000000006");
export const MEME = toAddress("0x9999999999999999999999999999999999999999");
export const POOL_ADDR = toAddress("0x1111111111111111111111111111111111111111");

export const pool: Pool = {
  chainId: 8453,
  address: POOL_ADDR,
  dex: "uniswap-v2",
  token0: WETH,
  token1: MEME,
};

/** Price 1.0 in scaled units (1 quote base unit per token, ×SCALE). */
export const P = (x: number): bigint => BigInt(Math.round(x * 1_000)) * (PRICE_SCALE / 1_000n);

export function rule(
  type: StrategyRule["type"],
  params: StrategyParams,
  overrides: Partial<StrategyRule> = {},
): StrategyRule {
  const state: StrategyState = overrides.state ?? {};
  return {
    id: `rule-${type}`,
    type,
    chainId: 8453,
    token: MEME,
    pool,
    walletId: "wallet-1",
    simulated: true,
    status: "active",
    params,
    state,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}
