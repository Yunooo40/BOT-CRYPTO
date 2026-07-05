import { toAddress } from "@bot/domain";
import { decodeEventLog, encodeAbiParameters, encodeEventTopics } from "viem";

/** encodeEventTopics types nullable slots; these fixtures fill every indexed arg. */
type EventTopics = [`0x${string}`, ...`0x${string}`[]];
import { describe, expect, it } from "vitest";
import {
  aerodromePoolCreated,
  defaultVenueSources,
  uniswapV2PairCreated,
  uniswapV3PoolCreated,
} from "./sources";

const TOKEN0 = "0x4200000000000000000000000000000000000006" as const;
const TOKEN1 = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const POOL = "0x1111111111111111111111111111111111111111" as const;

const bySlug = Object.fromEntries(defaultVenueSources().map((source) => [source.dex, source]));

describe("venue sources", () => {
  it("decodes a real-encoded Uniswap V2 PairCreated log into a Pool", () => {
    const topics = encodeEventTopics({
      abi: [uniswapV2PairCreated],
      args: { token0: TOKEN0, token1: TOKEN1 },
    });
    const data = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [POOL, 42n]);
    const decoded = decodeEventLog({
      abi: [uniswapV2PairCreated],
      topics: topics as EventTopics,
      data,
      strict: true,
    });
    expect(bySlug["uniswap-v2"]?.toPool(decoded.args, 8453)).toEqual({
      chainId: 8453,
      dex: "uniswap-v2",
      address: toAddress(POOL),
      token0: toAddress(TOKEN0),
      token1: toAddress(TOKEN1),
    });
  });

  it("decodes a Uniswap V3 PoolCreated log, carrying the fee tier", () => {
    const topics = encodeEventTopics({
      abi: [uniswapV3PoolCreated],
      args: { token0: TOKEN0, token1: TOKEN1, fee: 3_000 },
    });
    const data = encodeAbiParameters([{ type: "int24" }, { type: "address" }], [60, POOL]);
    const decoded = decodeEventLog({
      abi: [uniswapV3PoolCreated],
      topics: topics as EventTopics,
      data,
      strict: true,
    });
    expect(bySlug["uniswap-v3"]?.toPool(decoded.args, 8453)).toEqual({
      chainId: 8453,
      dex: "uniswap-v3",
      address: toAddress(POOL),
      token0: toAddress(TOKEN0),
      token1: toAddress(TOKEN1),
      feeTier: 3_000,
    });
  });

  it("decodes an Aerodrome PoolCreated log, carrying the stable flag", () => {
    const topics = encodeEventTopics({
      abi: [aerodromePoolCreated],
      args: { token0: TOKEN0, token1: TOKEN1, stable: true },
    });
    const data = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [POOL, 7n]);
    const decoded = decodeEventLog({
      abi: [aerodromePoolCreated],
      topics: topics as EventTopics,
      data,
      strict: true,
    });
    expect(bySlug["aerodrome"]?.toPool(decoded.args, 8453)).toEqual({
      chainId: 8453,
      dex: "aerodrome",
      address: toAddress(POOL),
      token0: toAddress(TOKEN0),
      token1: toAddress(TOKEN1),
      stable: true,
    });
  });

  it("returns undefined on malformed args instead of crashing", () => {
    expect(bySlug["uniswap-v2"]?.toPool({}, 8453)).toBeUndefined();
    expect(
      bySlug["uniswap-v3"]?.toPool({ token0: TOKEN0, token1: TOKEN1, pool: POOL }, 8453),
    ).toBeUndefined();
  });
});
