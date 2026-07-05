import { InfraError } from "@bot/errors";
import { createLogger, type Logger } from "@bot/logger";
import {
  meetsSeverity,
  type NotificationChannel,
  type NotificationMessage,
  type Notifier,
  type Severity,
} from "./message";

/** Route a message to channels when its severity clears `minSeverity`. */
export interface RoutingRule {
  channels: NotificationChannel[];
  minSeverity: Severity;
}

export interface DispatcherOptions {
  notifiers: Notifier[];
  /** Default routing when a message matches no specific rule. */
  defaultRule?: RoutingRule;
  logger?: Logger;
  /** Dedup window: identical `dedupeKey`s within it collapse to one. Default 60s. */
  dedupeTtlMs?: number;
  /** Per-channel token bucket: max sends per `rateWindowMs`. Default 20. */
  rateLimit?: number;
  rateWindowMs?: number;
  /** Retry attempts for InfraError sends (total = retries + 1). Default 2. */
  maxRetries?: number;
  retryBackoffMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Bucket {
  tokens: number;
  refilledAt: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Routes notifications to channels with severity filtering, dedup (by
 * `dedupeKey`, TTL), per-channel rate-limiting (token bucket), and retry of
 * transient (`InfraError`) send failures. A channel failing never blocks the
 * others — each send is isolated.
 */
export class NotificationDispatcher {
  readonly #notifiers: Map<NotificationChannel, Notifier>;
  readonly #defaultRule: RoutingRule;
  readonly #logger: Logger;
  readonly #dedupeTtlMs: number;
  readonly #rateLimit: number;
  readonly #rateWindowMs: number;
  readonly #maxRetries: number;
  readonly #backoffMs: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;

  readonly #dedupe = new Map<string, number>();
  readonly #buckets = new Map<NotificationChannel, Bucket>();

  constructor(options: DispatcherOptions) {
    this.#notifiers = new Map(options.notifiers.map((n) => [n.channel, n]));
    this.#defaultRule = options.defaultRule ?? {
      channels: [...this.#notifiers.keys()],
      minSeverity: "info",
    };
    this.#logger = options.logger ?? createLogger({ name: "notify" });
    this.#dedupeTtlMs = options.dedupeTtlMs ?? 60_000;
    this.#rateLimit = options.rateLimit ?? 20;
    this.#rateWindowMs = options.rateWindowMs ?? 60_000;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#backoffMs = options.retryBackoffMs ?? 200;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Dispatch a message to the rule's channels. Returns the channels actually
   * sent to (after dedup/rate-limit). Never throws — per-channel failures are
   * logged and swallowed so one bad channel can't sink the rest.
   */
  async dispatch(message: NotificationMessage, rule?: RoutingRule): Promise<NotificationChannel[]> {
    const effective = rule ?? this.#defaultRule;
    if (!meetsSeverity(message.severity, effective.minSeverity)) {
      return [];
    }
    if (this.#isDuplicate(message)) {
      return [];
    }
    const sent: NotificationChannel[] = [];
    for (const channel of effective.channels) {
      const notifier = this.#notifiers.get(channel);
      if (notifier === undefined) continue;
      if (!this.#takeToken(channel)) {
        this.#logger.warn({ channel }, "notification rate-limited, dropped");
        continue;
      }
      if (await this.#sendWithRetry(notifier, message)) {
        sent.push(channel);
      }
    }
    return sent;
  }

  #isDuplicate(message: NotificationMessage): boolean {
    if (message.dedupeKey === undefined) return false;
    const now = this.#now();
    const seenAt = this.#dedupe.get(message.dedupeKey);
    if (seenAt !== undefined && now - seenAt < this.#dedupeTtlMs) {
      return true;
    }
    this.#dedupe.set(message.dedupeKey, now);
    // Opportunistic cleanup of expired keys.
    if (this.#dedupe.size > 1_000) {
      for (const [key, at] of this.#dedupe) {
        if (now - at >= this.#dedupeTtlMs) this.#dedupe.delete(key);
      }
    }
    return false;
  }

  #takeToken(channel: NotificationChannel): boolean {
    const now = this.#now();
    const bucket = this.#buckets.get(channel) ?? { tokens: this.#rateLimit, refilledAt: now };
    if (now - bucket.refilledAt >= this.#rateWindowMs) {
      bucket.tokens = this.#rateLimit;
      bucket.refilledAt = now;
    }
    if (bucket.tokens <= 0) {
      this.#buckets.set(channel, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.#buckets.set(channel, bucket);
    return true;
  }

  async #sendWithRetry(notifier: Notifier, message: NotificationMessage): Promise<boolean> {
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      try {
        await notifier.send(message);
        return true;
      } catch (error) {
        const retryable = error instanceof InfraError;
        if (!retryable || attempt === this.#maxRetries) {
          this.#logger.warn(
            { channel: notifier.channel, err: error, retryable },
            "notification send failed",
          );
          return false;
        }
        await this.#sleep(this.#backoffMs * 2 ** attempt);
      }
    }
    return false;
  }
}
