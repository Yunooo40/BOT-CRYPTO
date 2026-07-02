import { toAddress } from "@bot/domain";
import { createLogger } from "@bot/logger";
import { describe, expect, it, vi } from "vitest";
import { createEvent, type EventOf } from "../catalog";
import { InMemoryEventBus } from "./in-memory";

const TOKEN = toAddress("0x4200000000000000000000000000000000000006");

/** A logger that discards everything, to keep expected-error tests quiet. */
const silentLogger = createLogger({ destination: { write: () => undefined } });

function tokenDetected(): EventOf<"token.detected"> {
  return createEvent(
    "token.detected",
    {
      token: { chainId: 8453, address: TOKEN, symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    },
    { source: "scanner" },
  );
}

describe("InMemoryEventBus", () => {
  it("delivers a published event to a subscriber of that type", async () => {
    const bus = new InMemoryEventBus();
    const received: string[] = [];

    await bus.subscribe(
      "token.detected",
      (event) => {
        received.push(event.payload.token.symbol);
      },
      { group: "test" },
    );
    await bus.publish(tokenDetected());

    expect(received).toEqual(["WETH"]);
    await bus.close();
  });

  it("fans out to multiple subscribers", async () => {
    const bus = new InMemoryEventBus();
    const a = vi.fn();
    const b = vi.fn();

    await bus.subscribe("token.detected", a, { group: "a" });
    await bus.subscribe("token.detected", b, { group: "b" });
    await bus.publish(tokenDetected());

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    await bus.close();
  });

  it("isolates a throwing handler from its siblings", async () => {
    const bus = new InMemoryEventBus({ logger: silentLogger });
    const good = vi.fn();

    await bus.subscribe(
      "token.detected",
      () => {
        throw new Error("boom");
      },
      { group: "bad" },
    );
    await bus.subscribe("token.detected", good, { group: "good" });

    await expect(bus.publish(tokenDetected())).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledOnce();
    await bus.close();
  });

  it("stops delivering after unsubscribe", async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    const unsubscribe = await bus.subscribe("token.detected", handler, { group: "x" });
    await unsubscribe();
    await bus.publish(tokenDetected());

    expect(handler).not.toHaveBeenCalled();
    await bus.close();
  });

  it("does nothing when an event has no subscribers", async () => {
    const bus = new InMemoryEventBus();
    await expect(bus.publish(tokenDetected())).resolves.toBeUndefined();
    await bus.close();
  });
});
