import { z } from "zod";
import { addressSchema } from "../primitives/address";
import { tokenAmountSchema } from "../primitives/amount";
import { chainIdSchema } from "../primitives/chain";

/** An open holding in a token, tracked for PnL and exit strategies. */
export const positionSchema = z.object({
  id: z.string().min(1),
  chainId: chainIdSchema,
  token: addressSchema,
  amount: tokenAmountSchema,
  /** Average entry price expressed in the quote asset's base units. */
  averageEntry: tokenAmountSchema,
  openedAt: z.number().int().positive(),
  simulated: z.boolean(),
});

export type Position = z.infer<typeof positionSchema>;
