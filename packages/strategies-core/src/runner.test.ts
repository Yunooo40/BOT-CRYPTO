import { InMemoryEventBus, type DomainEvent } from "@bot/events";
import { createLogger } from "@bot/logger";
import { describe, expect, it, vi } from "vitest";
import { InMemoryStrategyStore } from "./in-memory";
import type { PositionSource, PriceSource } from "./ports";
import { StrategyRunner } from "./runner";
import { P, rule } from "./test-helpers";

const silent = createLogger({ destination: { write: () => {} } });

function fixedPrice(price: bigint | undefined): PriceSource {
  return { priceOf: vi.fn(async () => price) };
}
function fixedPosition(amount: bigint): PositionSource {
  return { amountOf: vi.fn(async () => amount) };
}

async function harness(price: bigint | undefined, positionAmount: bigint, clock = { t: 0 }) {
  const bus = new InMemoryEventBus({ logger: silent });
  const store = new InMemoryStrategyStore();
  const sells: DomainEvent[] = [];
  const buys: DomainEvent[] = [];
  await bus.subscribe("sell.requested", (e) => void sells.push(e), { group: "t" });
  await bus.subscribe("buy.requested", (e) => void buys.push(e), { group: "t" });
  const runner = new StrategyRunner({
    bus,
    store,
    prices: fixedPrice(price),
    positions: fixedPosition(positionAmount),
    logger: silent,
    now: () => clock.t,
  });
  return { runner, store, sells, buys, clock };
}

describe("StrategyRunner", () => {
  it("evaluates an active rule and publishes the emitted intent", async () => {
    const { runner, store, sells } = await harness(P(1.5), 1_000n);
    await store.upsert(
      rule("take-profit", {
        kind: "take-profit",
        entryPrice: P(1),
        gainBps: 5_000,
        sellFractionBps: 10_000,
        maxSlippageBps: 100,
      }),
    );
    await runner.tick();
    expect(sells).toHaveLength(1);
    expect(sells[0]?.source).toBe("strategy");
  });

  it("transitions a fired rule to triggered so it can't re-fire (idempotence)", async () => {
    const { runner, store, sells } = await harness(P(1.5), 1_000n);
    const r = rule("take-profit", {
      kind: "take-profit",
      entryPrice: P(1),
      gainBps: 5_000,
      sellFractionBps: 10_000,
      maxSlippageBps: 100,
    });
    await store.upsert(r);
    await runner.tick();
    await runner.tick(); // second tick: rule is no longer active
    expect(sells).toHaveLength(1);
    expect((await store.get(r.id))?.status).toBe("triggered");
  });

  it("persists the trailing high-water mark across ticks, then sells on the drop", async () => {
    const clock = { t: 0 };
    const bus = new InMemoryEventBus({ logger: silent });
    const store = new InMemoryStrategyStore();
    const sells: DomainEvent[] = [];
    await bus.subscribe("sell.requested", (e) => void sells.push(e), { group: "t" });
    let price = P(2);
    const runner = new StrategyRunner({
      bus,
      store,
      prices: { priceOf: async () => price },
      positions: { amountOf: async () => 1_000n },
      logger: silent,
      now: () => clock.t,
    });
    const r = rule("trailing-stop", {
      kind: "trailing-stop",
      trailingBps: 1_000,
      sellFractionBps: 10_000,
      maxSlippageBps: 100,
    });
    await store.upsert(r);

    await runner.tick(); // high = 2.0, no sell
    expect((await store.get(r.id))?.state.highWaterMark).toBe(P(2));
    price = P(3);
    await runner.tick(); // high climbs to 3.0
    expect((await store.get(r.id))?.state.highWaterMark).toBe(P(3));
    price = P(2.6); // > 10% below 3.0 → sell
    await runner.tick();
    expect(sells).toHaveLength(1);
  });

  it("runs DCA across intervals with a mocked clock", async () => {
    const clock = { t: 100_000 };
    const { runner, store, buys } = await harness(undefined, 0n, clock);
    const r = rule("dca", {
      kind: "dca",
      amountPerBuy: 1_000n,
      intervalMs: 60_000,
      totalBuys: 2,
      maxSlippageBps: 100,
    });
    await store.upsert(r);

    await runner.tick(); // tranche 1
    expect(buys).toHaveLength(1);
    await runner.tick(); // too soon
    expect(buys).toHaveLength(1);
    clock.t = 160_000;
    await runner.tick(); // tranche 2 → done
    expect(buys).toHaveLength(2);
    expect((await store.get(r.id))?.status).toBe("done");
  });

  it("skips a rule when the price is unavailable", async () => {
    const { runner, store, sells } = await harness(undefined, 1_000n);
    await store.upsert(
      rule("stop-loss", {
        kind: "stop-loss",
        entryPrice: P(1),
        lossBps: 2_000,
        sellFractionBps: 10_000,
        maxSlippageBps: 100,
      }),
    );
    await runner.tick();
    expect(sells).toHaveLength(0);
  });
});
