import { Controller, Get, Inject, Query } from "@nestjs/common";
import { z } from "zod";
import { RequireScopes } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { TRADE_HISTORY_REPOSITORY } from "../tokens";
import type { TradeHistoryRecord, TradeHistoryRepository } from "./trade-history";

const tradesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

type TradesQuery = z.infer<typeof tradesQuerySchema>;

/** JSON-safe rendering: bigints as decimal strings. */
interface TradeResponse {
  id: string;
  chainId: number;
  side: "buy" | "sell";
  token: string;
  amountIn: string;
  amountInDecimals: number;
  amountOut: string;
  amountOutDecimals: number;
  txHash: string;
  simulated: boolean;
  occurredAt: number;
}

interface TradesResponse {
  items: TradeResponse[];
  nextCursor?: string;
}

function toResponse(record: TradeHistoryRecord): TradeResponse {
  return {
    id: record.id,
    chainId: record.chainId,
    side: record.side,
    token: record.token,
    amountIn: record.amountIn.raw.toString(),
    amountInDecimals: record.amountIn.decimals,
    amountOut: record.amountOut.raw.toString(),
    amountOutDecimals: record.amountOut.decimals,
    txHash: record.txHash,
    simulated: record.simulated,
    occurredAt: record.occurredAt,
  };
}

/** Paginated trade log (M13), newest first — see `ingestor.ts` for how it fills. */
@Controller("v1/trades")
export class TradesController {
  constructor(@Inject(TRADE_HISTORY_REPOSITORY) private readonly history: TradeHistoryRepository) {}

  @RequireScopes("read")
  @Get()
  async list(
    @Query(new ZodValidationPipe(tradesQuerySchema)) query: TradesQuery,
  ): Promise<TradesResponse> {
    const page = await this.history.list(query);
    return {
      items: page.items.map(toResponse),
      ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
    };
  }
}
