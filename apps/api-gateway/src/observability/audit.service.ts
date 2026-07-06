import type { EventBus } from "@bot/events";
import type { Logger } from "@bot/logger";
import { Auditor, type AuditSink } from "@bot/observability-core";
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { AUDIT_SINK, EVENT_BUS, LOGGER } from "../tokens";

/**
 * Runs the observability core's {@link Auditor} inside the gateway's lifecycle:
 * subscribes to the money-moving events at boot and writes each to the audit
 * sink. A stable consumer group means one row per action across replicas.
 */
@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  readonly #auditor: Auditor;

  constructor(
    @Inject(EVENT_BUS) bus: EventBus,
    @Inject(AUDIT_SINK) sink: AuditSink,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.#auditor = new Auditor({ bus, sink, logger, group: "api-gateway-audit" });
  }

  async onModuleInit(): Promise<void> {
    await this.#auditor.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.#auditor.stop();
  }
}
