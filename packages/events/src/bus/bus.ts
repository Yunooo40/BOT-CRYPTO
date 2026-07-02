import type { DomainEvent, EventOf, EventType } from "../catalog";

export type EventHandler<T extends EventType> = (event: EventOf<T>) => void | Promise<void>;

/** Detaches a subscription and releases its resources. */
export type Unsubscribe = () => Promise<void>;

export interface SubscribeOptions {
  /**
   * Consumer group — usually the service name. Members of a group share the
   * work (each event goes to one member) and delivery is acknowledged.
   */
  group: string;
  /** Unique consumer id within the group. Defaults to a random id. */
  consumer?: string;
}

/**
 * The one channel every service talks through. Implementations must deliver at
 * least once; handlers are therefore expected to be idempotent.
 */
export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe<T extends EventType>(
    type: T,
    handler: EventHandler<T>,
    options: SubscribeOptions,
  ): Promise<Unsubscribe>;
  close(): Promise<void>;
}
