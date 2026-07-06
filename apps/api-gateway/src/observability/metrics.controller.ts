import { PROMETHEUS_CONTENT_TYPE, type MetricRegistry } from "@bot/observability-core";
import { Controller, Get, Header, Inject } from "@nestjs/common";
import { RequireScopes } from "../common/decorators";
import { METRICS } from "../tokens";

/**
 * Prometheus scrape endpoint. Guarded by the `read` scope like `/v1/status`:
 * this gateway is opinionated about auth (routes fail closed), and metrics are
 * operational data, so we don't leave them world-readable. A scraper sends a
 * bearer token or an API key with `read`.
 */
@Controller()
export class MetricsController {
  constructor(@Inject(METRICS) private readonly registry: MetricRegistry) {}

  @RequireScopes("read")
  @Get("metrics")
  @Header("Content-Type", PROMETHEUS_CONTENT_TYPE)
  scrape(): string {
    return this.registry.expose();
  }
}
