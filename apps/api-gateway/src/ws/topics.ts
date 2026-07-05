import { domainEventSchema, type EventType } from "@bot/events";
import type { Scope } from "../auth/scopes";

/**
 * Every event type in the catalog, derived from the schema so a new event in
 * `@bot/events` is streamable without touching the gateway.
 */
export const EVENT_TYPES: readonly EventType[] = domainEventSchema.options.map(
  (option) => option.shape.type.value,
);

/**
 * Scope required to subscribe to a topic. Everything today is observational
 * (read); a future topic carrying order intents can demand more here.
 */
const TOPIC_SCOPES: Partial<Record<EventType, Scope>> = {};

export function requiredScopeFor(type: EventType): Scope {
  return TOPIC_SCOPES[type] ?? "read";
}

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}
