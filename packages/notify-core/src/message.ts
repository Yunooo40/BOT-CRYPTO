/** Severity of a notification, ordered — used for `minSeverity` routing. */
export type Severity = "info" | "success" | "warning" | "critical";

export const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  success: 1,
  warning: 2,
  critical: 3,
};

/** Channel-agnostic notification content. Each notifier renders it its own way. */
export interface NotificationMessage {
  title: string;
  body: string;
  severity: Severity;
  /** Structured key/value details (token, amount, txHash…). */
  fields?: { label: string; value: string }[];
  /** A URL the notification links to (explorer, dashboard). */
  link?: string;
  /**
   * Idempotency key for dedup. Two messages with the same key within the TTL
   * are collapsed to one — a retried event won't double-notify.
   */
  dedupeKey?: string;
}

export type NotificationChannel = "telegram" | "discord" | "webhook" | "email";

/** One outbound channel. `send` must reject on failure so the dispatcher retries. */
export interface Notifier {
  readonly channel: NotificationChannel;
  send(message: NotificationMessage): Promise<void>;
}

/** True when `severity` meets or exceeds `min`. */
export function meetsSeverity(severity: Severity, min: Severity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[min];
}
