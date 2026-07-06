import type { EventBus, Unsubscribe } from "@bot/events";
import type { Logger } from "@bot/logger";
import { AlertEngine, type Alert } from "@bot/observability-core";
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { EVENT_BUS, LOGGER } from "../tokens";

/**
 * Watches the bus for failure signals (`trade.failed`, danger verdicts) and
 * fires the observability core's threshold rules. The default channel is a
 * structured log line — log-based alerting works out of the box and needs no
 * external tokens; swap `dispatch` for a `@bot/notify-core` dispatcher (with
 * `alertToNotification`) to page Telegram/Discord when channels are configured.
 */
@Injectable()
export class AlertService implements OnModuleInit, OnModuleDestroy {
  readonly #engine: AlertEngine;
  readonly #unsubscribes: Unsubscribe[] = [];

  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.#engine = new AlertEngine({ dispatch: (alert) => this.#emit(alert), logger });
  }

  async onModuleInit(): Promise<void> {
    for (const type of ["trade.failed", "risk.assessed"] as const) {
      this.#unsubscribes.push(
        await this.bus.subscribe(type, (event) => this.#engine.observeEvent(event), {
          group: "api-gateway-alerts",
        }),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.#unsubscribes.map((off) => off().catch(() => undefined)));
    this.#unsubscribes.length = 0;
  }

  #emit(alert: Alert): Promise<void> {
    const line = { alert: alert.rule, count: alert.count, windowMs: alert.windowMs };
    if (alert.severity === "critical") {
      this.logger.error(line, alert.title);
    } else {
      this.logger.warn(line, alert.title);
    }
    return Promise.resolve();
  }
}
