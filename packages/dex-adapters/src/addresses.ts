import { toAddress, type Address } from "@bot/domain";

/**
 * Canonical deployments on Base (chainId 8453). Every adapter takes these as
 * overridable options — tests, forks and future chains swap them out.
 */

export const BASE_WETH = toAddress("0x4200000000000000000000000000000000000006");
export const BASE_USDC = toAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");

export interface UniswapV2Addresses {
  factory: Address;
  router: Address;
}

export const BASE_UNISWAP_V2: UniswapV2Addresses = {
  factory: toAddress("0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6"),
  router: toAddress("0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24"),
};

export interface UniswapV3Addresses {
  factory: Address;
  /** QuoterV2 — quotes via eth_call. */
  quoter: Address;
  /** SwapRouter02 — deadline is carried by its `multicall(deadline, ...)`. */
  router: Address;
}

export const BASE_UNISWAP_V3: UniswapV3Addresses = {
  factory: toAddress("0x33128a8fC17869897dcE68Ed026d694621f6FDfD"),
  quoter: toAddress("0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a"),
  router: toAddress("0x2626664c2603336E57B271c5C0b26F421741e481"),
};

export interface AerodromeAddresses {
  /** PoolFactory (v2-style pools, stable + volatile). */
  factory: Address;
  router: Address;
}

export const BASE_AERODROME: AerodromeAddresses = {
  factory: toAddress("0x420DD381b31aEf6683db6B902084cB0FFECe40Da"),
  router: toAddress("0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43"),
};
