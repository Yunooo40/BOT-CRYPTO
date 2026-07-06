import { ValidationError } from "@bot/errors";
import { describe, expect, it } from "vitest";
import { Histogram, MetricRegistry, PROMETHEUS_CONTENT_TYPE } from "./registry";

describe("MetricRegistry", () => {
  it("exposes a counter with HELP and TYPE headers", () => {
    const registry = new MetricRegistry();
    const counter = registry.counter({ name: "events_total", help: "events seen" });
    counter.inc();
    counter.inc({}, 3);

    const text = registry.expose();
    expect(text).toContain("# HELP events_total events seen");
    expect(text).toContain("# TYPE events_total counter");
    expect(text).toContain("events_total 4");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("keeps one series per label combination", () => {
    const registry = new MetricRegistry();
    const counter = registry.counter({
      name: "events_by_type_total",
      help: "events by type",
      labelNames: ["type"],
    });
    counter.inc({ type: "trade.executed" });
    counter.inc({ type: "trade.executed" });
    counter.inc({ type: "trade.failed" });

    expect(counter.get({ type: "trade.executed" })).toBe(2);
    expect(counter.get({ type: "trade.failed" })).toBe(1);
    const text = registry.expose();
    expect(text).toContain('events_by_type_total{type="trade.executed"} 2');
    expect(text).toContain('events_by_type_total{type="trade.failed"} 1');
  });

  it("supports gauges going up and down", () => {
    const registry = new MetricRegistry();
    const gauge = registry.gauge({ name: "inflight", help: "in-flight" });
    gauge.set(5);
    gauge.inc();
    gauge.dec({}, 2);
    expect(gauge.get()).toBe(4);
    expect(registry.expose()).toContain("inflight 4");
  });

  it("renders histogram cumulative buckets, sum and count", () => {
    const registry = new MetricRegistry();
    const hist = registry.histogram({
      name: "latency_seconds",
      help: "latency",
      buckets: [0.1, 0.5, 1],
    });
    hist.observe(0.05);
    hist.observe(0.2);
    hist.observe(2);

    const text = registry.expose();
    expect(text).toContain('latency_seconds_bucket{le="0.1"} 1');
    expect(text).toContain('latency_seconds_bucket{le="0.5"} 2');
    expect(text).toContain('latency_seconds_bucket{le="1"} 2');
    expect(text).toContain('latency_seconds_bucket{le="+Inf"} 3');
    expect(text).toContain("latency_seconds_sum 2.25");
    expect(text).toContain("latency_seconds_count 3");
  });

  it("escapes label values and rejects bad names", () => {
    const registry = new MetricRegistry();
    const counter = registry.counter({ name: "msgs", help: "m", labelNames: ["reason"] });
    counter.inc({ reason: 'a"b\\c' });
    expect(registry.expose()).toContain('msgs{reason="a\\"b\\\\c"} 1');

    expect(() => registry.counter({ name: "bad name", help: "x" })).toThrow(ValidationError);
  });

  it("rejects a missing required label and a duplicate metric name", () => {
    const registry = new MetricRegistry();
    const counter = registry.counter({ name: "c_total", help: "c", labelNames: ["k"] });
    expect(() => counter.inc({})).toThrow(ValidationError);
    expect(() => registry.counter({ name: "c_total", help: "c" })).toThrow(ValidationError);
  });

  it("rejects non-ascending histogram buckets", () => {
    expect(() => new Histogram({ name: "h", help: "h", buckets: [1, 0.5] })).toThrow(
      ValidationError,
    );
  });

  it("publishes the Prometheus content type", () => {
    expect(PROMETHEUS_CONTENT_TYPE).toContain("text/plain");
    expect(PROMETHEUS_CONTENT_TYPE).toContain("version=0.0.4");
  });
});
