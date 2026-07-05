import { BASE_AERODROME, BASE_UNISWAP_V2, BASE_UNISWAP_V3 } from "@bot/dex-adapters";
import { toAddress, type Address, type ChainId, type Pool } from "@bot/domain";
import { parseAbiItem, type AbiEvent } from "viem";

/**
 * One factory to watch: which contract, which creation event, and how a
 * decoded log becomes a domain `Pool`. `args` arrives from viem's `getLogs`
 * with the event ABI attached, so fields are already decoded.
 */
export interface VenueSource {
  dex: Pool["dex"];
  factory: Address;
  event: AbiEvent;
  toPool(args: Record<string, unknown>, chainId: ChainId): Pool | undefined;
}

export const uniswapV2PairCreated = parseAbiItem(
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256 length)",
);

export const uniswapV3PoolCreated = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
);

export const aerodromePoolCreated = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, bool indexed stable, address pool, uint256 length)",
);

function addresses(args: Record<string, unknown>, poolField: string) {
  const token0 = args["token0"];
  const token1 = args["token1"];
  const pool = args[poolField];
  if (typeof token0 !== "string" || typeof token1 !== "string" || typeof pool !== "string") {
    return undefined;
  }
  return { token0: toAddress(token0), token1: toAddress(token1), address: toAddress(pool) };
}

export function defaultVenueSources(): VenueSource[] {
  return [
    {
      dex: "uniswap-v2",
      factory: BASE_UNISWAP_V2.factory,
      event: uniswapV2PairCreated,
      toPool(args, chainId) {
        const base = addresses(args, "pair");
        return base === undefined ? undefined : { chainId, dex: "uniswap-v2", ...base };
      },
    },
    {
      dex: "uniswap-v3",
      factory: BASE_UNISWAP_V3.factory,
      event: uniswapV3PoolCreated,
      toPool(args, chainId) {
        const base = addresses(args, "pool");
        if (base === undefined || typeof args["fee"] !== "number") {
          return undefined;
        }
        return { chainId, dex: "uniswap-v3", feeTier: args["fee"], ...base };
      },
    },
    {
      dex: "aerodrome",
      factory: BASE_AERODROME.factory,
      event: aerodromePoolCreated,
      toPool(args, chainId) {
        const base = addresses(args, "pool");
        if (base === undefined || typeof args["stable"] !== "boolean") {
          return undefined;
        }
        return { chainId, dex: "aerodrome", stable: args["stable"], ...base };
      },
    },
  ];
}
