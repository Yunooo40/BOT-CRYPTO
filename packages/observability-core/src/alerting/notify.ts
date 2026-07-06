import type { NotificationMessage } from "@bot/notify-core";
import type { Alert } from "./engine";

/**
 * Render a fired {@link Alert} as a channel-agnostic notification. Carries the
 * rule's `dedupeKey` through so `@bot/notify-core`'s dispatcher collapses a
 * retried alert into one message.
 */
export function alertToNotification(alert: Alert): NotificationMessage {
  return {
    title: alert.title,
    body: alert.body,
    severity: alert.severity,
    dedupeKey: alert.dedupeKey,
    fields: [
      { label: "Rule", value: alert.rule },
      { label: "Count", value: String(alert.count) },
      { label: "Window", value: `${Math.round(alert.windowMs / 1000)}s` },
    ],
  };
}
