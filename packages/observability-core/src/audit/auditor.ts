import type { DomainEvent, EventBus, Unsubscribe } from "@bot/events";
import { createLogger, type Logger } from "@bot/logger";
import type { AuditRecord, AuditSink } from "./record";

/** The events worth an audit row — the money-moving outcomes. */
const AUDITED_TYPES = ["trade.executed", "trade.failed"] as const;

/**
 * Map a domain event to an audit record, or `null` if it is not an audited
 * action. Pure and total: never throws, never copies a secret (the source
 * events carry none), and renders bigint amounts as strings so the record is
 * JSON/jsonb-safe.
 */
export function auditRecordOf(event: DomainEvent): AuditRecord | null {
  const base = {
    id: event.id,
    action: event.type,
    occurredAt: event.occurredAt,
    correlationId: event.correlationId,
    userId: event.userId,
    source: event.source,
  } as const;

  switch (event.type) {
    case "trade.executed": {
      const { trade } = event.payload;
      return {
        ...base,
        outcome: "success",
        subject: trade.token,
        detail: {
          side: trade.side,
          amountInRaw: trade.amountIn.raw.toString(),
          amountInDecimals: trade.amountIn.decimals,
          amountOutRaw: trade.amountOut.raw.toString(),
          amountOutDecimals: trade.amountOut.decimals,
          txHash: trade.txHash,
          simulated: trade.simulated,
        },
      };
    }
    case "trade.failed": {
      const { intent, reason, retryable } = event.payload;
      return {
        ...base,
        outcome: "failure",
        subject: intent.token,
        detail: {
          side: intent.side,
          amountInRaw: intent.amountIn.raw.toString(),
          amountInDecimals: intent.amountIn.decimals,
          simulated: intent.simulated,
          reason,
          retryable,
        },
      };
    }
    default:
      return null;
  }
}

export interface AuditorOptions {
  bus: EventBus;
  sink: AuditSink;
  logger?: Logger;
  /** Consumer group; shared across replicas so each action is written once. Default "audit". */
  group?: string;
}

/**
 * Subscribes to the money-moving events and writes an {@link AuditRecord} for
 * each. Framework-agnostic — the api-gateway wraps it in a Nest lifecycle
 * provider. A sink failure re-throws so the bus redelivers: an audit row must
 * not be silently lost, and the sink is idempotent on the event id.
 */
export class Auditor {
  readonly #bus: EventBus;
  readonly #sink: AuditSink;
  readonly #logger: Logger;
  readonly #group: string;
  readonly #unsubscribes: Unsubscribe[] = [];

  constructor(options: AuditorOptions) {
    this.#bus = options.bus;
    this.#sink = options.sink;
    this.#logger = options.logger ?? createLogger({ name: "auditor" });
    this.#group = options.group ?? "audit";
  }

  async start(): Promise<void> {
    for (const type of AUDITED_TYPES) {
      const unsubscribe = await this.#bus.subscribe(type, (event) => this.#write(event), {
        group: this.#group,
      });
      this.#unsubscribes.push(unsubscribe);
    }
  }

  async stop(): Promise<void> {
    await Promise.all(
      this.#unsubscribes.map((unsubscribe) => unsubscribe().catch(() => undefined)),
    );
    this.#unsubscribes.length = 0;
  }

  async #write(event: DomainEvent): Promise<void> {
    const record = auditRecordOf(event);
    if (record === null) {
      return;
    }
    try {
      await this.#sink.record(record);
    } catch (error) {
      this.#logger.error(
        { err: error, id: record.id, action: record.action },
        "failed to write audit record; leaving event for redelivery",
      );
      throw error;
    }
  }
}
