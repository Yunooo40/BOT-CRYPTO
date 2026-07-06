import type { EventBus, Unsubscribe } from "@bot/events";
import type { Logger } from "@bot/logger";
import type { NotificationDispatcher } from "@bot/notify-core";
import { alertToNotification, AlertEngine, type Alert } from "@bot/observability-core";
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { EVENT_BUS, LOGGER, NOTIFICATION_DISPATCHER } from "../tokens";

/**
 * Watches the bus for failure signals (`trade.failed`, danger verdicts) and
 * fires the observability core's threshold rules. Every fired alert is always
 * logged (a structured line, so alerting never depends on an external
 * service being reachable) and also handed to the injected
 * `NotificationDispatcher` — a no-op when no channel is configured, a real
 * Telegram page once `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ALERT_CHAT_ID` are set.
 */
@Injectable()
export class AlertService implements OnModuleInit, OnModuleDestroy {
  readonly #engine: AlertEngine;
  readonly #unsubscribes: Unsubscribe[] = [];

  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(NOTIFICATION_DISPATCHER) private readonly dispatcher: NotificationDispatcher,
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

  async #emit(alert: Alert): Promise<void> {
    const line = { alert: alert.rule, count: alert.count, windowMs: alert.windowMs };
    if (alert.severity === "critical") {
      this.logger.error(line, alert.title);
    } else {
      this.logger.warn(line, alert.title);
    }
    // The dispatcher never throws (per-channel failures are logged and
    // swallowed internally) and is a safe no-op with zero notifiers.
    await this.dispatcher.dispatch(alertToNotification(alert));
  }
}
