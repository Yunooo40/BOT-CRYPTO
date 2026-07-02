import {
  addressSchema,
  chainIdSchema,
  newCorrelationId,
  newEventId,
  now,
  poolSchema,
  riskScoreSchema,
  tokenSchema,
  tradeIntentSchema,
  tradeSchema,
  type CorrelationId,
} from "@bot/domain";
import { ValidationError } from "@bot/errors";
import { z } from "zod";
import { defineEvent } from "./envelope";

/**
 * Event catalog — the shared vocabulary services publish and consume.
 *
 * This is the M1 starter set covering the critical path
 * (detect → assess → decide → execute). Each later module appends its own
 * events here; nothing else changes.
 */

export const tokenDetectedEvent = defineEvent(
  "token.detected",
  z.object({ token: tokenSchema, pool: poolSchema.optional() }),
);

export const poolCreatedEvent = defineEvent("pool.created", z.object({ pool: poolSchema }));

export const riskAssessedEvent = defineEvent(
  "risk.assessed",
  z.object({ chainId: chainIdSchema, token: addressSchema, risk: riskScoreSchema }),
);

export const buyRequestedEvent = defineEvent(
  "buy.requested",
  z.object({ intent: tradeIntentSchema }),
);

export const sellRequestedEvent = defineEvent(
  "sell.requested",
  z.object({ intent: tradeIntentSchema }),
);

export const tradeExecutedEvent = defineEvent("trade.executed", z.object({ trade: tradeSchema }));

export const tradeFailedEvent = defineEvent(
  "trade.failed",
  z.object({ intent: tradeIntentSchema, reason: z.string(), retryable: z.boolean() }),
);

export const domainEventSchema = z.discriminatedUnion("type", [
  tokenDetectedEvent,
  poolCreatedEvent,
  riskAssessedEvent,
  buyRequestedEvent,
  sellRequestedEvent,
  tradeExecutedEvent,
  tradeFailedEvent,
]);

/** The union of every event on the bus. */
export type DomainEvent = z.infer<typeof domainEventSchema>;

/** All valid event type discriminators. */
export type EventType = DomainEvent["type"];

/** The concrete event for a given type (e.g. `EventOf<"trade.executed">`). */
export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;

/** The payload shape for a given event type. */
export type EventPayload<T extends EventType> = EventOf<T>["payload"];

export interface EventMeta {
  /** The emitting service (e.g. "scanner", "engine"). */
  source: string;
  /** Reuse a correlation id to link this event to an existing flow; else a new one is minted. */
  correlationId?: CorrelationId | string;
  /** Owning user for multi-tenant setups; null (default) for system events. */
  userId?: string | null;
}

/**
 * Build a fully-formed, validated event from a payload plus minimal metadata.
 * Fills id / occurredAt / correlationId / userId and validates the whole thing.
 */
export function createEvent<T extends EventType>(
  type: T,
  payload: EventPayload<T>,
  meta: EventMeta,
): EventOf<T> {
  const candidate = {
    id: newEventId(),
    type,
    occurredAt: now(),
    source: meta.source,
    correlationId: meta.correlationId ?? newCorrelationId(),
    userId: meta.userId ?? null,
    payload,
  };
  return parseEvent(candidate) as EventOf<T>;
}

/** Validate an unknown value as a {@link DomainEvent} (used on the consume side). */
export function parseEvent(value: unknown): DomainEvent {
  const result = domainEventSchema.safeParse(value);
  if (!result.success) {
    throw new ValidationError("Invalid domain event", {
      context: { issues: result.error.issues },
    });
  }
  return result.data;
}
