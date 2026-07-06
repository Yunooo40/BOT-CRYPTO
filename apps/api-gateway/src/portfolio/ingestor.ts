import { applyTrade, type PositionStore } from "@bot/engine-core";
import type { EventBus, EventOf, Unsubscribe } from "@bot/events";
import type { Logger } from "@bot/logger";
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { CLOCK, EVENT_BUS, LOGGER, PORTFOLIO_POSITIONS, TRADE_HISTORY_REPOSITORY } from "../tokens";
import { tradeHistoryRecordOf, type TradeHistoryRepository } from "./trade-history";

/**
 * Builds the dashboard's read-model by replaying `trade.executed`: appends to
 * the trade log and folds into the position book via the Trading Engine's own
 * (pure, already-tested) `applyTrade`. A STABLE consumer group — shared by
 * every gateway replica — so each trade is folded exactly once; contrast with
 * `EventsGateway`, whose per-instance random group intentionally broadcasts.
 */
@Injectable()
export class PortfolioIngestor implements OnModuleInit, OnModuleDestroy {
  #unsubscribe: Unsubscribe | undefined;

  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(TRADE_HISTORY_REPOSITORY) private readonly history: TradeHistoryRepository,
    @Inject(PORTFOLIO_POSITIONS) private readonly positions: PositionStore,
    @Inject(CLOCK) private readonly clock: () => number,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    this.#unsubscribe = await this.bus.subscribe("trade.executed", (event) => this.#handle(event), {
      group: "api-gateway-portfolio",
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.#unsubscribe?.().catch(() => undefined);
  }

  async #handle(event: EventOf<"trade.executed">): Promise<void> {
    const { trade } = event.payload;
    await this.history.append(tradeHistoryRecordOf(trade, event.occurredAt));
    await applyTrade(this.positions, trade, this.clock);
    this.logger.debug({ tradeId: trade.id }, "trade folded into portfolio read-model");
  }
}
