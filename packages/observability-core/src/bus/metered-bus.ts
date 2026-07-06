import type {
  DomainEvent,
  EventBus,
  EventHandler,
  EventType,
  SubscribeOptions,
  Unsubscribe,
} from "@bot/events";
import { Counter, DEFAULT_BUCKETS, Histogram, type MetricRegistry } from "../metrics/registry";

export interface MeteredEventBusOptions {
  /** Metric name prefix. Default "bot_". */
  prefix?: string;
  /** Clock in ms, injected for deterministic tests. Default `Date.now`. */
  now?: () => number;
}

/**
 * Wraps any {@link EventBus} and records publish/consume throughput, handler
 * failures and handler latency into a {@link MetricRegistry} — without changing
 * the underlying bus. A failing handler still throws, so the inner bus's
 * at-least-once redelivery is preserved; we only observe it on the way past.
 */
export class MeteredEventBus implements EventBus {
  readonly #inner: EventBus;
  readonly #now: () => number;
  readonly #published: Counter;
  readonly #consumed: Counter;
  readonly #failures: Counter;
  readonly #duration: Histogram;

  constructor(inner: EventBus, registry: MetricRegistry, options: MeteredEventBusOptions = {}) {
    this.#inner = inner;
    this.#now = options.now ?? Date.now;
    const prefix = options.prefix ?? "bot_";

    this.#published = registry.counter({
      name: `${prefix}events_published_total`,
      help: "Events published to the bus.",
      labelNames: ["type"],
    });
    this.#consumed = registry.counter({
      name: `${prefix}events_consumed_total`,
      help: "Handler deliveries attempted (success and failure).",
      labelNames: ["type"],
    });
    this.#failures = registry.counter({
      name: `${prefix}event_handler_failures_total`,
      help: "Handler deliveries that threw.",
      labelNames: ["type"],
    });
    this.#duration = registry.histogram({
      name: `${prefix}event_handler_duration_seconds`,
      help: "Handler execution time in seconds.",
      labelNames: ["type"],
      buckets: [...DEFAULT_BUCKETS],
    });
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.#inner.publish(event);
    // Count only after a successful publish — a throw means it never hit the bus.
    this.#published.inc({ type: event.type });
  }

  subscribe<T extends EventType>(
    type: T,
    handler: EventHandler<T>,
    options: SubscribeOptions,
  ): Promise<Unsubscribe> {
    const instrumented: EventHandler<T> = async (event) => {
      const startedAt = this.#now();
      try {
        await handler(event);
      } catch (error) {
        this.#failures.inc({ type });
        throw error;
      } finally {
        this.#consumed.inc({ type });
        this.#duration.observe((this.#now() - startedAt) / 1000, { type });
      }
    };
    return this.#inner.subscribe(type, instrumented, options);
  }

  close(): Promise<void> {
    return this.#inner.close();
  }
}
