// Metrics
export {
  Counter,
  DEFAULT_BUCKETS,
  Gauge,
  Histogram,
  MetricRegistry,
  PROMETHEUS_CONTENT_TYPE,
  type HistogramOptions,
  type Labels,
  type MetricOptions,
} from "./metrics/registry";

// Instrumented event bus
export { MeteredEventBus, type MeteredEventBusOptions } from "./bus/metered-bus";

// Audit trail
export {
  InMemoryAuditSink,
  type AuditOutcome,
  type AuditRecord,
  type AuditSink,
} from "./audit/record";
export { Auditor, auditRecordOf, type AuditorOptions } from "./audit/auditor";

// Alerting
export {
  AlertEngine,
  alertSignalsOf,
  DEFAULT_ALERT_RULES,
  type Alert,
  type AlertEngineOptions,
  type AlertRule,
  type AlertSignal,
} from "./alerting/engine";
export { alertToNotification } from "./alerting/notify";
