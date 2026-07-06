import { toAddress } from "@bot/domain";
import { createEvent, InMemoryEventBus } from "@bot/events";
import { createLogger } from "@bot/logger";
import { describe, expect, it } from "vitest";
import { MetricRegistry } from "../metrics/registry";
import { MeteredEventBus } from "./metered-bus";

const TOKEN = toAddress("0x4200000000000000000000000000000000000006");
const silent = createLogger({ destination: { write: () => undefined } });

function tokenDetected() {
  return createEvent(
    "token.detected",
    {
      token: { chainId: 8453, address: TOKEN, symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    },
    { source: "scanner" },
  );
}

describe("MeteredEventBus", () => {
  it("counts published and consumed events by type", async () => {
    const registry = new MetricRegistry();
    const bus = new MeteredEventBus(new InMemoryEventBus({ logger: silent }), registry);

    await bus.subscribe("token.detected", () => undefined, { group: "g" });
    await bus.publish(tokenDetected());
    await bus.publish(tokenDetected());

    const text = registry.expose();
    expect(text).toContain('bot_events_published_total{type="token.detected"} 2');
    expect(text).toContain('bot_events_consumed_total{type="token.detected"} 2');
    // No failures occurred: a counter with no observed series emits only its
    // HELP/TYPE headers, never a `... 0` line (standard Prometheus behavior).
    expect(text).toContain("# TYPE bot_event_handler_failures_total counter");
    expect(text).not.toContain('bot_event_handler_failures_total{type="token.detected"}');
  });

  it("records a handler failure and still lets it propagate to the inner bus", async () => {
    const registry = new MetricRegistry();
    // InMemoryEventBus isolates a throwing handler (logs it); the metered wrapper
    // counts the failure on the way past by re-throwing into that isolation.
    const bus = new MeteredEventBus(new InMemoryEventBus({ logger: silent }), registry);

    await bus.subscribe(
      "token.detected",
      () => {
        throw new Error("boom");
      },
      { group: "bad" },
    );
    await bus.publish(tokenDetected());

    const text = registry.expose();
    expect(text).toContain('bot_events_consumed_total{type="token.detected"} 1');
    expect(text).toContain('bot_event_handler_failures_total{type="token.detected"} 1');
  });

  it("times handler execution into the latency histogram", async () => {
    const registry = new MetricRegistry();
    let clock = 1_000;
    const bus = new MeteredEventBus(new InMemoryEventBus({ logger: silent }), registry, {
      now: () => clock,
    });

    await bus.subscribe(
      "token.detected",
      () => {
        clock += 250; // 250ms handler
      },
      { group: "g" },
    );
    await bus.publish(tokenDetected());

    const text = registry.expose();
    expect(text).toContain('bot_event_handler_duration_seconds_count{type="token.detected"} 1');
    expect(text).toContain('bot_event_handler_duration_seconds_sum{type="token.detected"} 0.25');
  });

  it("delegates close to the wrapped bus", async () => {
    const registry = new MetricRegistry();
    let closed = false;
    const inner = new InMemoryEventBus({ logger: silent });
    const originalClose = inner.close.bind(inner);
    inner.close = async () => {
      closed = true;
      await originalClose();
    };
    const bus = new MeteredEventBus(inner, registry);
    await bus.close();
    expect(closed).toBe(true);
  });
});
