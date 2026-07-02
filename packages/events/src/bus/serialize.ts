import { parseEvent, type DomainEvent } from "../catalog";

/**
 * The wire form for the bus: JSON, with bigint amounts rendered as decimal
 * strings (bigint isn't JSON-serializable). {@link deserializeEvent} coerces
 * them back to bigint via the catalog schemas.
 */
export function serializeEvent(event: DomainEvent): string {
  return JSON.stringify(event, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

/** Parse a wire string back into a validated {@link DomainEvent}. */
export function deserializeEvent(raw: string): DomainEvent {
  return parseEvent(JSON.parse(raw));
}
