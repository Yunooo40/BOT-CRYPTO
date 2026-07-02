import { z } from "zod";
import { addressSchema } from "../primitives/address";
import { tokenAmountSchema } from "../primitives/amount";
import { chainIdSchema } from "../primitives/chain";

export const tradeSideSchema = z.enum(["buy", "sell"]);
export type TradeSide = z.infer<typeof tradeSideSchema>;

const txHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte tx hash");

/**
 * A desired trade before execution. `simulated` drives paper trading: the same
 * intent flows through the engine whether it hits the chain or a simulator.
 */
export const tradeIntentSchema = z.object({
  chainId: chainIdSchema,
  side: tradeSideSchema,
  token: addressSchema,
  amountIn: tokenAmountSchema,
  /** Max acceptable slippage, in basis points (100 = 1%). */
  maxSlippageBps: z.number().int().min(0).max(10_000),
  simulated: z.boolean().default(false),
});
export type TradeIntent = z.infer<typeof tradeIntentSchema>;

/** A settled trade (real or simulated). */
export const tradeSchema = z.object({
  id: z.string().min(1),
  chainId: chainIdSchema,
  side: tradeSideSchema,
  token: addressSchema,
  amountIn: tokenAmountSchema,
  amountOut: tokenAmountSchema,
  txHash: txHashSchema,
  simulated: z.boolean(),
});
export type Trade = z.infer<typeof tradeSchema>;
