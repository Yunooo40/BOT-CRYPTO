import type { DomainEvent } from "@bot/events";
import { createLogger, type Logger } from "@bot/logger";
import type { Severity } from "@bot/notify-core";

/** A single occurrence the engine counts, e.g. one failed trade. */
export interface AlertSignal {
  /** What happened, e.g. "trade.failed". Rules match on this. */
  key: string;
  /** Epoch ms it occurred. */
  at: number;
}

/**
 * A threshold rule: fire when `key` occurs at least `threshold` times within
 * `windowMs`. Simple by design — enough for "failures are spiking" or "we keep
 * seeing danger verdicts" without a query language.
 */
export interface AlertRule {
  name: string;
  key: string;
  windowMs: number;
  threshold: number;
  severity: Severity;
  title: string;
}

/** A fired alert, ready to be turned into a notification. */
export interface Alert {
  rule: string;
  severity: Severity;
  title: string;
  body: string;
  /** Count that tripped the rule. */
  count: number;
  windowMs: number;
  occurredAt: number;
  /** Idempotency key (the rule name) so downstream dedup collapses repeats. */
  dedupeKey: string;
}

/** Default rules covering the two failure modes that most warrant a ping. */
export const DEFAULT_ALERT_RULES: readonly AlertRule[] = [
  {
    name: "trade-failure-spike",
    key: "trade.failed",
    windowMs: 60_000,
    threshold: 3,
    severity: "critical",
    title: "Trade failures spiking",
  },
  {
    name: "repeated-danger-verdict",
    key: "risk.danger",
    windowMs: 300_000,
    threshold: 5,
    severity: "warning",
    title: "Repeated danger verdicts",
  },
];

/** Derive alert signals from a domain event. Pure; empty when nothing to count. */
export function alertSignalsOf(event: DomainEvent): AlertSignal[] {
  switch (event.type) {
    case "trade.failed":
      return [{ key: "trade.failed", at: event.occurredAt }];
    case "risk.assessed":
      return event.payload.risk.verdict === "danger"
        ? [{ key: "risk.danger", at: event.occurredAt }]
        : [];
    default:
      return [];
  }
}

export interface AlertEngineOptions {
  rules?: readonly AlertRule[];
  /** Called once per fired alert (after cooldown). Wire it to `@bot/notify-core`. */
  dispatch: (alert: Alert) => Promise<void>;
  logger?: Logger;
  /** Min gap between two firings of the same rule. Default 5 min. */
  cooldownMs?: number;
  now?: () => number;
}

/**
 * Counts signals over sliding windows and fires rules that cross their
 * threshold, with a per-rule cooldown so a sustained problem pings once, not on
 * every event. Feed it domain events via {@link observeEvent} or raw signals
 * via {@link record}.
 */
export class AlertEngine {
  readonly #rules: readonly AlertRule[];
  readonly #dispatch: (alert: Alert) => Promise<void>;
  readonly #logger: Logger;
  readonly #cooldownMs: number;
  readonly #now: () => number;
  readonly #timestamps = new Map<string, number[]>();
  readonly #lastFired = new Map<string, number>();
  readonly #maxWindowByKey = new Map<string, number>();

  constructor(options: AlertEngineOptions) {
    this.#rules = options.rules ?? DEFAULT_ALERT_RULES;
    this.#dispatch = options.dispatch;
    this.#logger = options.logger ?? createLogger({ name: "alert-engine" });
    this.#cooldownMs = options.cooldownMs ?? 300_000;
    this.#now = options.now ?? Date.now;
    for (const rule of this.#rules) {
      const current = this.#maxWindowByKey.get(rule.key) ?? 0;
      this.#maxWindowByKey.set(rule.key, Math.max(current, rule.windowMs));
    }
  }

  /** Feed a domain event; derives and records its signals. */
  async observeEvent(event: DomainEvent): Promise<void> {
    for (const signal of alertSignalsOf(event)) {
      await this.record(signal);
    }
  }

  /** Record one signal and evaluate every rule watching its key. */
  async record(signal: AlertSignal): Promise<void> {
    const series = this.#timestamps.get(signal.key) ?? [];
    series.push(signal.at);
    // Bound memory: keep only what the widest rule on this key could still count.
    const horizon = this.#now() - (this.#maxWindowByKey.get(signal.key) ?? 0);
    this.#timestamps.set(
      signal.key,
      series.filter((at) => at >= horizon),
    );

    for (const rule of this.#rules) {
      if (rule.key === signal.key) {
        await this.#evaluate(rule);
      }
    }
  }

  async #evaluate(rule: AlertRule): Promise<void> {
    const now = this.#now();
    const series = this.#timestamps.get(rule.key) ?? [];
    const count = series.filter((at) => at > now - rule.windowMs).length;
    if (count < rule.threshold) {
      return;
    }

    const lastFired = this.#lastFired.get(rule.name);
    if (lastFired !== undefined && now - lastFired < this.#cooldownMs) {
      return; // still cooling down — don't spam.
    }
    this.#lastFired.set(rule.name, now);

    const alert: Alert = {
      rule: rule.name,
      severity: rule.severity,
      title: rule.title,
      body: `${count} "${rule.key}" in the last ${Math.round(rule.windowMs / 1000)}s (threshold ${rule.threshold}).`,
      count,
      windowMs: rule.windowMs,
      occurredAt: now,
      dedupeKey: rule.name,
    };

    try {
      await this.#dispatch(alert);
    } catch (error) {
      this.#logger.error({ err: error, rule: rule.name }, "failed to dispatch alert");
    }
  }
}
