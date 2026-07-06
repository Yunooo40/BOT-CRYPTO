import { BASE_WETH } from "@bot/dex-adapters";
import type { PositionRecord, PositionStore } from "@bot/engine-core";
import type { Logger } from "@bot/logger";
import { Controller, Get, Inject } from "@nestjs/common";
import { RequireScopes } from "../common/decorators";
import type { QuoteFinder } from "../quotes/quote-finder";
import { LOGGER, PORTFOLIO_POSITIONS, QUOTE_FINDER } from "../tokens";

/** JSON-safe rendering: bigints as decimal strings. */
interface PositionResponse {
  id: string;
  chainId: number;
  token: string;
  simulated: boolean;
  amount: string;
  costBasis: string;
  realizedPnl: string;
  /** In the quote asset's (WETH) base units; `null` when no venue could price it right now. */
  unrealizedPnl: string | null;
  openedAt: number;
  updatedAt: number;
}

/**
 * Open positions folded from `trade.executed` (see `ingestor.ts`), enriched
 * with unrealized PnL priced live against the same quote engine as M3/M12
 * (`/v1/quotes`). Pricing a position never fails the whole list — a token
 * with no venue right now just reports `unrealizedPnl: null`.
 */
@Controller("v1/positions")
export class PositionsController {
  constructor(
    @Inject(PORTFOLIO_POSITIONS) private readonly positions: PositionStore,
    @Inject(QUOTE_FINDER) private readonly quotes: QuoteFinder,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @RequireScopes("read")
  @Get()
  async list(): Promise<PositionResponse[]> {
    const records = await this.positions.list();
    return Promise.all(records.map((record) => this.#toResponse(record)));
  }

  async #toResponse(record: PositionRecord): Promise<PositionResponse> {
    return {
      id: record.id,
      chainId: record.chainId,
      token: record.token,
      simulated: record.simulated,
      amount: record.amount.toString(),
      costBasis: record.costBasis.toString(),
      realizedPnl: record.realizedPnl.toString(),
      unrealizedPnl: (await this.#unrealizedPnl(record))?.toString() ?? null,
      openedAt: record.openedAt,
      updatedAt: record.updatedAt,
    };
  }

  async #unrealizedPnl(record: PositionRecord): Promise<bigint | undefined> {
    if (record.amount === 0n) {
      return 0n;
    }
    try {
      const quote = await this.quotes.bestQuote({
        tokenIn: record.token,
        tokenOut: BASE_WETH,
        amountIn: record.amount,
      });
      return quote.amountOut - record.costBasis;
    } catch (error) {
      this.logger.warn(
        { err: error, token: record.token },
        "could not price open position; omitting unrealized PnL",
      );
      return undefined;
    }
  }
}
