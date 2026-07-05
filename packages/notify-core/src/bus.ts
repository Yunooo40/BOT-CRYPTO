import type { EventBus, EventType, Unsubscribe } from "@bot/events";
import { createLogger, type Logger } from "@bot/logger";
import type { NotificationDispatcher, RoutingRule } from "./dispatcher";
import { formatEvent } from "./format";

export interface AttachNotificationsOptions {
  bus: EventBus;
  dispatcher: NotificationDispatcher;
  logger?: Logger;
  group?: string;
  /**
   * Event types to notify on. Defaults to the outcome events worth surfacing:
   * trades and dangerous risk verdicts.
   */
  eventTypes?: EventType[];
  /** Optional per-event-type routing override. */
  ruleFor?: (type: EventType) => RoutingRule | undefined;
}

const DEFAULT_TYPES: EventType[] = ["trade.executed", "trade.failed", "risk.assessed"];

/**
 * Subscribe the dispatcher to the bus: format each event to a notification and
 * dispatch it. Events with no notification mapping (e.g. a non-danger
 * `risk.assessed`) are silently ignored. Returns an unsubscribe handle.
 */
export async function attachNotifications(
  options: AttachNotificationsOptions,
): Promise<Unsubscribe> {
  const { bus, dispatcher } = options;
  const logger = options.logger ?? createLogger({ name: "notify-bus" });
  const group = options.group ?? "notifications";
  const types = options.eventTypes ?? DEFAULT_TYPES;

  const unsubs = await Promise.all(
    types.map((type) =>
      bus.subscribe(
        type,
        async (event) => {
          const message = formatEvent(event);
          if (message === undefined) return;
          const rule = options.ruleFor?.(type);
          const sent = await dispatcher.dispatch(message, rule);
          if (sent.length > 0) {
            logger.info({ type, channels: sent }, "notification dispatched");
          }
        },
        { group },
      ),
    ),
  );

  return async () => {
    for (const unsub of unsubs) {
      await unsub();
    }
  };
}
