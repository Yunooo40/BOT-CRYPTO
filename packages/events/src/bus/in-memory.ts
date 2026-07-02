import { createLogger, type Logger } from "@bot/logger";
import { parseEvent, type DomainEvent, type EventType } from "../catalog";
import type { EventBus, EventHandler, SubscribeOptions, Unsubscribe } from "./bus";

type AnyHandler = EventHandler<EventType>;

/**
 * In-process bus for tests and paper trading — no Redis required. Delivers each
 * event to every subscriber of its type; a throwing handler is logged and
 * isolated so it can't break siblings (mirrors independent consumers).
 */
export class InMemoryEventBus implements EventBus {
  readonly #handlers = new Map<EventType, Set<AnyHandler>>();
  readonly #logger: Logger;

  constructor(options: { logger?: Logger } = {}) {
    this.#logger = options.logger ?? createLogger({ name: "in-memory-bus" });
  }

  async publish(event: DomainEvent): Promise<void> {
    const parsed = parseEvent(event);
    const handlers = this.#handlers.get(parsed.type);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      try {
        await handler(parsed);
      } catch (error) {
        this.#logger.error(
          { err: error, eventId: parsed.id, type: parsed.type },
          "event handler failed",
        );
      }
    }
  }

  subscribe<T extends EventType>(
    type: T,
    handler: EventHandler<T>,
    _options: SubscribeOptions,
  ): Promise<Unsubscribe> {
    let handlers = this.#handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(type, handlers);
    }
    // A handler for a specific type is stored in a heterogeneous set; it is only
    // ever invoked with an event of that same type, so the widening is sound.
    const stored = handler as AnyHandler;
    handlers.add(stored);

    const unsubscribe: Unsubscribe = () => {
      handlers.delete(stored);
      return Promise.resolve();
    };
    return Promise.resolve(unsubscribe);
  }

  async close(): Promise<void> {
    this.#handlers.clear();
  }
}
