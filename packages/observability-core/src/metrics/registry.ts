import { ValidationError } from "@bot/errors";

/**
 * A tiny, dependency-free metrics registry that speaks the Prometheus text
 * exposition format. Deliberately not `prom-client`: the platform's cores stay
 * dependency-light, and everything we need (counters, gauges, histograms with
 * labels) fits in one auditable file.
 *
 * Metric and label names follow Prometheus rules; a bad name fails loud at
 * construction rather than producing an un-scrapeable `/metrics` at runtime.
 */

const NAME_REGEX = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

export type Labels = Record<string, string>;

export interface MetricOptions {
  name: string;
  help: string;
  /** Fixed label set. Every observation must supply exactly these keys. */
  labelNames?: readonly string[];
}

function assertName(name: string, kind: string): void {
  if (!NAME_REGEX.test(name)) {
    throw new ValidationError(`invalid ${kind} name: "${name}"`, { context: { name } });
  }
}

/** Canonical, order-stable key for a label set — the identity of one series. */
function seriesKey(labelNames: readonly string[], labels: Labels): string {
  if (labelNames.length === 0) {
    return "";
  }
  return labelNames.map((label) => `${label}=${labels[label] ?? ""}`).join(",");
}

function assertLabels(labelNames: readonly string[], labels: Labels): void {
  for (const name of labelNames) {
    if (labels[name] === undefined) {
      throw new ValidationError(`missing label "${name}"`, { context: { labelNames, labels } });
    }
  }
}

/** Escape a label value per the Prometheus text format (backslash, quote, newline). */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function renderLabels(labelNames: readonly string[], labels: Labels, extra?: Labels): string {
  const entries = [
    ...labelNames.map((name) => [name, labels[name] ?? ""] as const),
    ...(extra ? Object.entries(extra) : []),
  ];
  if (entries.length === 0) {
    return "";
  }
  const body = entries.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`).join(",");
  return `{${body}}`;
}

interface Sample {
  labels: Labels;
  render(name: string, labelNames: readonly string[]): string[];
}

interface Metric {
  readonly name: string;
  readonly help: string;
  readonly type: "counter" | "gauge" | "histogram";
  readonly labelNames: readonly string[];
  samples(): Sample[];
}

abstract class BaseMetric implements Metric {
  readonly name: string;
  readonly help: string;
  readonly labelNames: readonly string[];
  abstract readonly type: "counter" | "gauge" | "histogram";

  constructor(options: MetricOptions) {
    assertName(options.name, "metric");
    for (const label of options.labelNames ?? []) {
      assertName(label, "label");
    }
    this.name = options.name;
    this.help = options.help;
    this.labelNames = options.labelNames ?? [];
  }

  abstract samples(): Sample[];
}

/** A monotonically increasing count (requests, events, failures). */
export class Counter extends BaseMetric {
  readonly type = "counter";
  readonly #values = new Map<string, { labels: Labels; value: number }>();

  inc(labels: Labels = {}, value = 1): void {
    if (value < 0) {
      throw new ValidationError("counter increments must be non-negative", { context: { value } });
    }
    assertLabels(this.labelNames, labels);
    const key = seriesKey(this.labelNames, labels);
    const existing = this.#values.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.#values.set(key, { labels, value });
    }
  }

  get(labels: Labels = {}): number {
    return this.#values.get(seriesKey(this.labelNames, labels))?.value ?? 0;
  }

  samples(): Sample[] {
    return [...this.#values.values()].map(({ labels, value }) => ({
      labels,
      render: (name, labelNames) => [`${name}${renderLabels(labelNames, labels)} ${value}`],
    }));
  }
}

/** A value that can go up or down (in-flight work, pool size, latest score). */
export class Gauge extends BaseMetric {
  readonly type = "gauge";
  readonly #values = new Map<string, { labels: Labels; value: number }>();

  set(value: number, labels: Labels = {}): void {
    assertLabels(this.labelNames, labels);
    this.#values.set(seriesKey(this.labelNames, labels), { labels, value });
  }

  inc(labels: Labels = {}, value = 1): void {
    this.set(this.get(labels) + value, labels);
  }

  dec(labels: Labels = {}, value = 1): void {
    this.set(this.get(labels) - value, labels);
  }

  get(labels: Labels = {}): number {
    return this.#values.get(seriesKey(this.labelNames, labels))?.value ?? 0;
  }

  samples(): Sample[] {
    return [...this.#values.values()].map(({ labels, value }) => ({
      labels,
      render: (name, labelNames) => [`${name}${renderLabels(labelNames, labels)} ${value}`],
    }));
  }
}

/** Default latency buckets in seconds — spans a fast in-memory call to a slow RPC. */
export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

export interface HistogramOptions extends MetricOptions {
  /** Upper bounds (inclusive), ascending. `+Inf` is appended automatically. */
  buckets?: readonly number[];
}

interface HistogramSeries {
  labels: Labels;
  counts: number[];
  sum: number;
  count: number;
}

/** A distribution of observed values (latencies, sizes) into cumulative buckets. */
export class Histogram extends BaseMetric {
  readonly type = "histogram";
  readonly #buckets: readonly number[];
  readonly #series = new Map<string, HistogramSeries>();

  constructor(options: HistogramOptions) {
    super(options);
    const buckets = [...(options.buckets ?? DEFAULT_BUCKETS)];
    for (let i = 1; i < buckets.length; i += 1) {
      if (buckets[i]! <= buckets[i - 1]!) {
        throw new ValidationError("histogram buckets must be strictly ascending", {
          context: { buckets },
        });
      }
    }
    this.#buckets = buckets;
  }

  observe(value: number, labels: Labels = {}): void {
    assertLabels(this.labelNames, labels);
    const key = seriesKey(this.labelNames, labels);
    let series = this.#series.get(key);
    if (!series) {
      series = { labels, counts: this.#buckets.map(() => 0), sum: 0, count: 0 };
      this.#series.set(key, series);
    }
    series.sum += value;
    series.count += 1;
    for (let i = 0; i < this.#buckets.length; i += 1) {
      if (value <= this.#buckets[i]!) {
        series.counts[i]! += 1;
      }
    }
  }

  samples(): Sample[] {
    return [...this.#series.values()].map((series) => ({
      labels: series.labels,
      render: (name, labelNames) => {
        const lines: string[] = [];
        let cumulative = 0;
        for (let i = 0; i < this.#buckets.length; i += 1) {
          cumulative = series.counts[i]!;
          lines.push(
            `${name}_bucket${renderLabels(labelNames, series.labels, { le: String(this.#buckets[i]) })} ${cumulative}`,
          );
        }
        lines.push(
          `${name}_bucket${renderLabels(labelNames, series.labels, { le: "+Inf" })} ${series.count}`,
        );
        lines.push(`${name}_sum${renderLabels(labelNames, series.labels)} ${series.sum}`);
        lines.push(`${name}_count${renderLabels(labelNames, series.labels)} ${series.count}`);
        return lines;
      },
    }));
  }
}

/**
 * Owns a set of metrics and renders them together. One registry per process is
 * the norm; the `/metrics` endpoint calls {@link expose}.
 */
export class MetricRegistry {
  readonly #metrics = new Map<string, Metric>();

  #register<M extends Metric>(metric: M): M {
    if (this.#metrics.has(metric.name)) {
      throw new ValidationError(`metric "${metric.name}" already registered`, {
        context: { name: metric.name },
      });
    }
    this.#metrics.set(metric.name, metric);
    return metric;
  }

  counter(options: MetricOptions): Counter {
    return this.#register(new Counter(options));
  }

  gauge(options: MetricOptions): Gauge {
    return this.#register(new Gauge(options));
  }

  histogram(options: HistogramOptions): Histogram {
    return this.#register(new Histogram(options));
  }

  /** Render every metric in the Prometheus text exposition format. */
  expose(): string {
    const blocks: string[] = [];
    for (const metric of this.#metrics.values()) {
      const lines = [
        `# HELP ${metric.name} ${metric.help}`,
        `# TYPE ${metric.name} ${metric.type}`,
      ];
      for (const sample of metric.samples()) {
        lines.push(...sample.render(metric.name, metric.labelNames));
      }
      blocks.push(lines.join("\n"));
    }
    // Trailing newline: Prometheus requires the exposition to end with one.
    return blocks.length > 0 ? `${blocks.join("\n\n")}\n` : "";
  }
}

/** Content-Type a `/metrics` handler must set for Prometheus to parse the body. */
export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
