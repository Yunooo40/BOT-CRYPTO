import { z } from "zod";
import { addressSchema } from "../primitives/address";
import { chainIdSchema } from "../primitives/chain";

/** DEX venues the platform knows how to read/route on Base. */
export const dexSchema = z.enum(["uniswap-v2", "uniswap-v3", "aerodrome"]);
export type Dex = z.infer<typeof dexSchema>;

/** A liquidity pool pairing two tokens on a given DEX. */
export const poolSchema = z.object({
  chainId: chainIdSchema,
  address: addressSchema,
  dex: dexSchema,
  token0: addressSchema,
  token1: addressSchema,
  /** Fee tier in hundredths of a bip (Uniswap V3 style); absent for V2-style pools. */
  feeTier: z.number().int().nonnegative().optional(),
});

export type Pool = z.infer<typeof poolSchema>;
