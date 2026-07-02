import { randomUUID } from "node:crypto";
import { InfraError } from "@bot/errors";
import { createLogger, type Logger } from "@bot/logger";
import type { Redis } from "ioredis";
import { parseEvent, type DomainEvent, type EventOf, type EventType } from "../catalog";
import type { EventBus, EventHandler, SubscribeOptions, Unsubscribe } from "./bus";
import { deserializeEvent, serializeEvent } from "./serialize";

export interface RedisEventBusOptions {
  /** An ioredis client. The bus never reads env — the caller wires the connection. */
  redis: Redis;
  logger?: Logger;
  /** Stream key prefix. Default "evt:". */
  keyPrefix?: string;
  /** How long each blocking read waits, in ms. Default 5000. */
  blockMs?: number;
  /** Max messages fetched per read. Default 10. */
  batchSize?: number;
}

type StreamEntry = [id: string, fields: string[]];
type StreamReadReply = Array<[key: string, entries: StreamEntry[]]> | null;

interface Consumer {
  stop: () => void;
  done: Promise<void>;
  connection: Redis;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function readField(fields: string[], name: string): string | undefined {
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === name) {
      return fields[i + 1];
    }
  }
  return undefined;
}

/**
 * Redis Streams event bus. One stream per event type (`evt:<type>`), consumed
 * through consumer groups so delivery is at-least-once and acknowledged.
 *
 * Reliability contract: a message is XACK'd only after its handler resolves. If
 * the handler throws, the message stays pending and is redelivered — so
 * handlers must be idempotent.
 */
export class RedisEventBus implements EventBus {
  readonly #redis: Redis;
  readonly #logger: Logger;
  readonly #prefix: string;
  readonly #blockMs: number;
  readonly #batchSize: number;
  readonly #consumers = new Set<Consumer>();
  #closed = false;

  constructor(options: RedisEventBusOptions) {
    this.#redis = options.redis;
    this.#logger = options.logger ?? createLogger({ name: "redis-bus" });
    this.#prefix = options.keyPrefix ?? "evt:";
    this.#blockMs = options.blockMs ?? 5000;
    this.#batchSize = options.batchSize ?? 10;
  }

  #streamKey(type: EventType): string {
    return `${this.#prefix}${type}`;
  }

  async publish(event: DomainEvent): Promise<void> {
    const parsed = parseEvent(event);
    const key = this.#streamKey(parsed.type);
    try {
      await this.#redis.xadd(key, "*", "data", serializeEvent(parsed));
    } catch (error) {
      throw new InfraError("failed to publish event", {
        cause: error,
        context: { type: parsed.type, key },
      });
    }
  }

  async subscribe<T extends EventType>(
    type: T,
    handler: EventHandler<T>,
    options: SubscribeOptions,
  ): Promise<Unsubscribe> {
    const key = this.#streamKey(type);
    const { group } = options;
    const consumerName = options.consumer ?? `${group}-${randomUUID()}`;

    await this.#ensureGroup(key, group);

    // A dedicated connection: XREADGROUP blocks, so it must not share the pool.
    const connection = this.#redis.duplicate();
    connection.on("error", (error: Error) => {
      this.#logger.error({ err: error, key, group }, "consumer connection error");
    });

    let stopped = false;
    const stop = (): void => {
      stopped = true;
    };
    const done = this.#runLoop(connection, key, group, consumerName, handler, () => stopped);
    const consumer: Consumer = { stop, done, connection };
    this.#consumers.add(consumer);

    return async () => {
      stop();
      await done;
      await connection.quit().catch(() => undefined);
      this.#consumers.delete(consumer);
    };
  }

  async close(): Promise<void> {
    this.#closed = true;
    const shutdowns = [...this.#consumers].map(async (consumer) => {
      consumer.stop();
      await consumer.done;
      await consumer.connection.quit().catch(() => undefined);
    });
    this.#consumers.clear();
    await Promise.all(shutdowns);
  }

  async #ensureGroup(key: string, group: string): Promise<void> {
    try {
      await this.#redis.xgroup("CREATE", key, group, "$", "MKSTREAM");
    } catch (error) {
      // The group already existing is the normal steady-state case, not an error.
      if (error instanceof Error && error.message.includes("BUSYGROUP")) {
        return;
      }
      throw new InfraError("failed to create consumer group", {
        cause: error,
        context: { key, group },
      });
    }
  }

  async #runLoop<T extends EventType>(
    connection: Redis,
    key: string,
    group: string,
    consumerName: string,
    handler: EventHandler<T>,
    isStopped: () => boolean,
  ): Promise<void> {
    while (!isStopped() && !this.#closed) {
      let reply: StreamReadReply;
      try {
        reply = (await connection.xreadgroup(
          "GROUP",
          group,
          consumerName,
          "COUNT",
          this.#batchSize,
          "BLOCK",
          this.#blockMs,
          "STREAMS",
          key,
          ">",
        )) as unknown as StreamReadReply;
      } catch (error) {
        if (isStopped() || this.#closed) {
          break;
        }
        this.#logger.error({ err: error, key }, "xreadgroup failed; backing off");
        await delay(500);
        continue;
      }

      if (!reply) {
        continue;
      }

      for (const [, entries] of reply) {
        for (const [id, fields] of entries) {
          await this.#dispatch(connection, key, group, id, fields, handler);
        }
      }
    }
  }

  async #dispatch<T extends EventType>(
    connection: Redis,
    key: string,
    group: string,
    id: string,
    fields: string[],
    handler: EventHandler<T>,
  ): Promise<void> {
    const data = readField(fields, "data");
    if (data === undefined) {
      // Malformed entry with no payload — ack and move on so it can't wedge the group.
      await connection.xack(key, group, id);
      return;
    }
    try {
      const event = deserializeEvent(data) as EventOf<T>;
      await handler(event);
      await connection.xack(key, group, id);
    } catch (error) {
      this.#logger.error(
        { err: error, key, id },
        "event handler failed; leaving message pending for redelivery",
      );
    }
  }
}
