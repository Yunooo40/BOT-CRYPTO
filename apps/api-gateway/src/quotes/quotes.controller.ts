import { addressSchema, dexSchema } from "@bot/domain";
import type { Quote } from "@bot/dex-adapters";
import { Controller, Get, Inject, Query } from "@nestjs/common";
import { z } from "zod";
import { RequireScopes } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { QUOTE_FINDER } from "../tokens";
import type { QuoteFinder } from "./quote-finder";

const quoteQuerySchema = z
  .object({
    tokenIn: addressSchema,
    tokenOut: addressSchema,
    amountIn: z
      .string()
      .regex(/^[0-9]+$/, "must be an integer amount in base units")
      .transform((value) => BigInt(value))
      .refine((value) => value > 0n, "must be positive"),
    venue: dexSchema.optional(),
  })
  .refine((query) => query.tokenIn !== query.tokenOut, {
    message: "tokenIn and tokenOut must differ",
    path: ["tokenOut"],
  });

type QuoteQuery = z.infer<typeof quoteQuerySchema>;

/** JSON-safe rendering: bigints as decimal strings. */
interface QuoteResponse {
  venue: string;
  pool: {
    address: string;
    feeTier?: number;
    stable?: boolean;
  };
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpactBps?: number;
}

function toResponse(quote: Quote): QuoteResponse {
  return {
    venue: quote.pool.dex,
    pool: {
      address: quote.pool.address,
      ...(quote.pool.feeTier !== undefined ? { feeTier: quote.pool.feeTier } : {}),
      ...(quote.pool.stable !== undefined ? { stable: quote.pool.stable } : {}),
    },
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: quote.amountIn.toString(),
    amountOut: quote.amountOut.toString(),
    ...(quote.priceImpactBps !== undefined ? { priceImpactBps: quote.priceImpactBps } : {}),
  };
}

/**
 * Read-only best-execution quote across every venue the platform knows
 * (M3 adapters over the M2 RPC pool). Trading on it arrives with M7.
 */
@Controller("v1/quotes")
export class QuotesController {
  constructor(@Inject(QUOTE_FINDER) private readonly quotes: QuoteFinder) {}

  @RequireScopes("read")
  @Get()
  async quote(
    @Query(new ZodValidationPipe(quoteQuerySchema)) query: QuoteQuery,
  ): Promise<QuoteResponse> {
    const quote = await this.quotes.bestQuote(query);
    return toResponse(quote);
  }
}
