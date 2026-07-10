import { createEvent, InMemoryEventBus, type DomainEvent } from "@bot/events";
import { createLogger } from "@bot/logger";
import { describe, expect, it, vi } from "vitest";
import { attachEngine } from "./bus";
import { TradingEngine } from "./engine";
import { PaperExecutor } from "./paper-executor";
import { InMemoryPositionStore } from "./positions";
import { buyIntent, pool, stubRouter } from "./test-helpers";

const silent = createLogger({ destination: { write: () => {} } });

async function harness(amountOut: bigint) {
  const bus = new InMemoryEventBus({ logger: silent });
  const executed: DomainEvent[] = [];
  const failed: DomainEvent[] = [];
  await bus.subscribe("trade.executed", (event) => void executed.push(event), { group: "t" });
  await bus.subscribe("trade.failed", (event) => void failed.push(event), { group: "t" });
  const { router } = stubRouter(amountOut);
  const engine = new TradingEngine({
    executor: new PaperExecutor({ router }),
    positions: new InMemoryPositionStore(),
    logger: silent,
  });
  return { bus, engine, executed, failed };
}

describe("attachEngine", () => {
  it("consumes buy.requested and publishes a correlated trade.executed", async () => {
    const { bus, engine, executed } = await harness(2_000n);
    await attachEngine({ bus, engine, logger: silent, resolvePool: async () => pool });

    const requested = createEvent("buy.requested", { intent: buyIntent() }, { source: "test" });
    await bus.publish(requested);

    expect(executed).toHaveLength(1);
    expect(executed[0]?.correlationId).toBe(requested.correlationId);
    expect(executed[0]?.payload).toMatchObject({ trade: { simulated: true } });
  });

  it("publishes trade.failed when no pool can be resolved", async () => {
    const { bus, engine, failed } = await harness(1n);
    await attachEngine({ bus, engine, logger: silent, resolvePool: async () => undefined });
    await bus.publish(createEvent("buy.requested", { intent: buyIntent() }, { source: "test" }));
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload).toMatchObject({ retryable: false });
  });

  it("logs a warning when no pool can be resolved, not just a silent failure", async () => {
    const { bus, engine } = await harness(1n);
    const warn = vi.fn();
    const logger = { ...silent, warn };
    await attachEngine({ bus, engine, logger, resolvePool: async () => undefined });
    await bus.publish(createEvent("buy.requested", { intent: buyIntent() }, { source: "test" }));
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[1]).toContain("no pool");
  });

  it("uses the event id as the idempotency key", async () => {
    const { bus, engine, executed } = await harness(2_000n);
    await attachEngine({ bus, engine, logger: silent, resolvePool: async () => pool });
    const event = createEvent("buy.requested", { intent: buyIntent() }, { source: "test" });
    await bus.publish(event);
    await bus.publish(event); // redelivery
    expect(executed).toHaveLength(2); // published each time…
    // …but both carry the same trade id (executed once under the hood).
    expect(executed[0]?.payload).toMatchObject({ trade: { id: event.id } });
    expect(executed[1]?.payload).toMatchObject({ trade: { id: event.id } });
  });
});
