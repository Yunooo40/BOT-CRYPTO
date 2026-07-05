import { createEvent, type EventBus, type EventOf, type Unsubscribe } from "@bot/events";
import { createLogger, type Logger } from "@bot/logger";
import type { Pool, TradeIntent } from "@bot/domain";
import type { TradingEngine } from "./engine";

export interface AttachEngineOptions {
  bus: EventBus;
  engine: TradingEngine;
  logger?: Logger;
  group?: string;
  /**
   * Resolve the pool for an intent. Buy/sell events carry only the intent, so
   * the app supplies routing (e.g. from the Scanner's last pool for the token).
   */
  resolvePool: (intent: TradeIntent) => Promise<Pool | undefined>;
}

/**
 * Wire the engine onto the bus: consume `buy.requested` / `sell.requested`,
 * execute, and publish `trade.executed` or `trade.failed` with the same
 * correlation id. The event id is the idempotency key, so an at-least-once
 * redelivery never double-trades.
 */
export async function attachEngine(options: AttachEngineOptions): Promise<Unsubscribe> {
  const { bus, engine } = options;
  const logger = options.logger ?? createLogger({ name: "engine-bus" });
  const group = options.group ?? "engine";

  const handle = async (event: EventOf<"buy.requested" | "sell.requested">): Promise<void> => {
    const intent = event.payload.intent;
    const pool = await options.resolvePool(intent);
    if (pool === undefined) {
      await bus.publish(
        createEvent(
          "trade.failed",
          { intent, reason: "no pool available to route the trade", retryable: false },
          { source: "engine", correlationId: event.correlationId },
        ),
      );
      return;
    }
    const result = await engine.trade(intent, pool, event.id);
    if (result.status === "executed" && result.trade !== undefined) {
      await bus.publish(
        createEvent(
          "trade.executed",
          { trade: result.trade },
          { source: "engine", correlationId: event.correlationId },
        ),
      );
      return;
    }
    await bus.publish(
      createEvent(
        "trade.failed",
        { intent, reason: result.reason ?? "trade failed", retryable: result.retryable ?? false },
        { source: "engine", correlationId: event.correlationId },
      ),
    );
    logger.warn({ intentId: event.id, status: result.status }, "trade not executed");
  };

  const unsubBuy = await bus.subscribe("buy.requested", handle, { group });
  const unsubSell = await bus.subscribe("sell.requested", handle, { group });
  return async () => {
    await unsubBuy();
    await unsubSell();
  };
}
