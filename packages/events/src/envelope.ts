import { z } from "zod";

/**
 * Stamps the common envelope onto an event's payload. Every event carries:
 * - `id`            unique per event
 * - `type`          discriminator (a literal, so events form a discriminated union)
 * - `occurredAt`    epoch ms
 * - `source`        the emitting service
 * - `correlationId` ties one logical flow together across services
 * - `userId`        multi-tenant owner, or null for system-wide events
 *
 * Producers never build this by hand — {@link createEvent} does it for them.
 */
export function defineEvent<Type extends string, Payload extends z.ZodTypeAny>(
  type: Type,
  payload: Payload,
) {
  return z.object({
    id: z.string().min(1),
    type: z.literal(type),
    occurredAt: z.number().int().positive(),
    source: z.string().min(1),
    correlationId: z.string().min(1),
    userId: z.string().nullable(),
    payload,
  });
}
