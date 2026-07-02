import { randomUUID } from "node:crypto";

/** Unique id of a single event. */
export type EventId = string & { readonly __brand: "EventId" };

/**
 * Ties together every event produced while handling one logical flow — e.g. a
 * token from `token.detected` → `risk.assessed` → `buy.requested` →
 * `trade.executed` shares one correlation id, so a whole snipe is traceable.
 */
export type CorrelationId = string & { readonly __brand: "CorrelationId" };

/** Epoch milliseconds. */
export type Timestamp = number & { readonly __brand: "Timestamp" };

export const newEventId = (): EventId => randomUUID() as EventId;

export const newCorrelationId = (): CorrelationId => randomUUID() as CorrelationId;

export const now = (): Timestamp => Date.now() as Timestamp;
