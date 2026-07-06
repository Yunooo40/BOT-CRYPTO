import { Controller, Get, Inject } from "@nestjs/common";
import { RequireScopes } from "../common/decorators";
import { TRADE_HISTORY_REPOSITORY } from "../tokens";
import { computeAnalytics, type AnalyticsSummary } from "./analytics";
import type { TradeHistoryRepository } from "./trade-history";

/** Derived metrics (ROI, win rate, PnL breakdowns) over the full trade log. */
@Controller("v1/analytics")
export class AnalyticsController {
  constructor(@Inject(TRADE_HISTORY_REPOSITORY) private readonly history: TradeHistoryRepository) {}

  @RequireScopes("read")
  @Get("summary")
  async summary(): Promise<AnalyticsSummary> {
    const records = await this.history.listAll();
    return computeAnalytics(records);
  }
}
