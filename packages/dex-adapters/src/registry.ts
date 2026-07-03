import type { Dex } from "@bot/domain";
import type { ChainReader, DexAdapter } from "./adapter";
import { AerodromeAdapter, type AerodromeAdapterOptions } from "./aerodrome";
import { UniswapV2Adapter, type UniswapV2AdapterOptions } from "./uniswap-v2";
import { UniswapV3Adapter, type UniswapV3AdapterOptions } from "./uniswap-v3";

export interface CreateDexAdaptersOptions {
  uniswapV2?: Omit<UniswapV2AdapterOptions, "client">;
  uniswapV3?: Omit<UniswapV3AdapterOptions, "client">;
  aerodrome?: Omit<AerodromeAdapterOptions, "client">;
}

/**
 * Every venue the platform trades on, keyed by `Dex` — what the Scanner and
 * Engine iterate over. One shared client (in practice: the RpcPool's).
 */
export function createDexAdapters(
  client: ChainReader,
  options: CreateDexAdaptersOptions = {},
): Map<Dex, DexAdapter> {
  const adapters: DexAdapter[] = [
    new UniswapV2Adapter({ client, ...options.uniswapV2 }),
    new UniswapV3Adapter({ client, ...options.uniswapV3 }),
    new AerodromeAdapter({ client, ...options.aerodrome }),
  ];
  return new Map(adapters.map((adapter) => [adapter.dex, adapter]));
}
