import { InMemoryEventBus, type EventOf } from "@bot/events";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryCopyStore } from "./in-memory";
import type { PositionSource } from "./ports";
import type { ObservedSwap, TrackedWallet } from "./rules";
import { CopyRunner } from "./runner";
import { MEME, swap, wallet } from "./test-helpers";
import { WalletWatcher } from "./watcher";

/** A watcher stub that yields a fixed script of swaps once, then nothing. */
function scriptedWatcher(script: ObservedSwap[]): WalletWatcher {
  let delivered = false;
  return {
    async scan(_w: TrackedWallet) {
      if (delivered) return { swaps: [], caughtUp: true };
      delivered = true;
      return { swaps: script, caughtUp: true };
    },
  } as unknown as WalletWatcher;
}

const positions = (held: bigint): PositionSource => ({
  async amountOf() {
    return held;
  },
});

describe("CopyRunner", () => {
  let bus: InMemoryEventBus;
  let store: InMemoryCopyStore;
  const buys: EventOf<"buy.requested">[] = [];
  const sells: EventOf<"sell.requested">[] = [];

  beforeEach(async () => {
    bus = new InMemoryEventBus();
    store = new InMemoryCopyStore();
    buys.length = 0;
    sells.length = 0;
    await bus.subscribe("buy.requested", (e) => void buys.push(e), { group: "test" });
    await bus.subscribe("sell.requested", (e) => void sells.push(e), { group: "test" });
  });

  it("publishes a buy.requested for a copied leader buy", async () => {
    await store.upsertWallet(wallet({ sizeBps: 5_000 }));
    const runner = new CopyRunner({
      bus,
      store,
      watcher: scriptedWatcher([swap({ side: "buy", amountIn: 1_000n })]),
      positions: positions(0n),
    });
    await runner.tick();
    expect(buys).toHaveLength(1);
    expect(buys[0]?.payload.intent.amountIn.raw).toBe(500n);
    expect(buys[0]?.source).toBe("copy");
  });

  it("does not copy the same swap twice (idempotent)", async () => {
    await store.upsertWallet(wallet());
    const script = [swap({ side: "buy", txHash: "0x" + "33".repeat(32), logIndex: 2 })];
    const runner = new CopyRunner({
      bus,
      store,
      watcher: scriptedWatcher(script),
      positions: positions(0n),
    });
    await runner.tick();
    // Re-run with the same swap re-delivered: dedup blocks a second emit.
    const runner2 = new CopyRunner({
      bus,
      store,
      watcher: scriptedWatcher(script),
      positions: positions(0n),
    });
    await runner2.tick();
    expect(buys).toHaveLength(1);
  });

  it("mirrors a leader sell out of our position", async () => {
    await store.upsertWallet(wallet({ mode: "percent", sizeBps: 10_000, copySells: true }));
    const runner = new CopyRunner({
      bus,
      store,
      watcher: scriptedWatcher([swap({ side: "sell", token: MEME })]),
      positions: positions(600n),
    });
    await runner.tick();
    expect(sells).toHaveLength(1);
    expect(sells[0]?.payload.intent.amountIn.raw).toBe(600n);
  });

  it("vetoes a buy when the shield gate rejects it, but marks it copied", async () => {
    await store.upsertWallet(wallet());
    const runner = new CopyRunner({
      bus,
      store,
      watcher: scriptedWatcher([swap({ side: "buy" })]),
      positions: positions(0n),
      shieldGate: async () => false,
    });
    await runner.tick();
    expect(buys).toHaveLength(0);
  });
});
