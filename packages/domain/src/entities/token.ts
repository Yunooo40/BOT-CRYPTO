import { z } from "zod";
import { addressSchema } from "../primitives/address";
import { chainIdSchema } from "../primitives/chain";

/** An ERC-20 token. */
export const tokenSchema = z.object({
  chainId: chainIdSchema,
  address: addressSchema,
  symbol: z.string().min(1).max(32),
  name: z.string().max(128),
  decimals: z.number().int().min(0).max(36),
});

export type Token = z.infer<typeof tokenSchema>;
