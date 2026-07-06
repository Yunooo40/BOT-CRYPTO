/**
 * The audit trail is the platform's tamper-evident memory of money-moving and
 * security-sensitive actions: what happened, when, on whose behalf, tied to the
 * flow that caused it. It is append-only and must never contain a secret — the
 * mappers below only ever copy non-sensitive fields.
 */

export type AuditOutcome = "success" | "failure";

export interface AuditRecord {
  /** Stable id — the source event's id, so a redelivered event is one row. */
  id: string;
  /** What happened, e.g. "trade.executed". Mirrors the event type it came from. */
  action: string;
  /** Epoch ms the action occurred. */
  occurredAt: number;
  /** Ties this record to the whole logical flow (detect → assess → execute). */
  correlationId: string;
  /** Owning user for multi-tenant setups, or null for system actions. */
  userId: string | null;
  /** The emitting service. */
  source: string;
  outcome: AuditOutcome;
  /** The primary thing acted on (usually a token address); optional. */
  subject?: string;
  /** Non-sensitive structured context. bigint amounts are rendered as strings. */
  detail: Record<string, string | number | boolean>;
}

/** Append-only store for audit records. Implementations MUST be idempotent on `id`. */
export interface AuditSink {
  record(record: AuditRecord): Promise<void>;
}

/** In-memory sink for tests and paper trading. Idempotent on `id`. */
export class InMemoryAuditSink implements AuditSink {
  readonly #byId = new Map<string, AuditRecord>();

  async record(record: AuditRecord): Promise<void> {
    if (!this.#byId.has(record.id)) {
      this.#byId.set(record.id, record);
    }
  }

  /** Every record, oldest first. */
  list(): AuditRecord[] {
    return [...this.#byId.values()];
  }
}
