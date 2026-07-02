import { toAddress, tokenAmount } from "@bot/domain";
import { ValidationError } from "@bot/errors";
import { describe, expect, it } from "vitest";
import { deserializeEvent, serializeEvent } from "./bus/serialize";
import { createEvent, parseEvent } from "./catalog";

const WETH = toAddress("0x4200000000000000000000000000000000000006");

describe("createEvent", () => {
  it("builds a validated, fully-stamped event", () => {
    const event = createEvent(
      "buy.requested",
      {
        intent: {
          chainId: 8453,
          side: "buy",
          token: WETH,
          amountIn: tokenAmount(1_000_000_000_000_000_000n, 18),
          maxSlippageBps: 100,
          simulated: true,
        },
      },
      { source: "engine" },
    );

    expect(event.type).toBe("buy.requested");
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.source).toBe("engine");
    expect(event.correlationId.length).toBeGreaterThan(0);
    expect(event.userId).toBeNull();
    expect(event.payload.intent.token).toBe(WETH);
  });

  it("reuses a provided correlation id", () => {
    const first = createEvent(
      "token.detected",
      {
        token: {
          chainId: 8453,
          address: WETH,
          symbol: "WETH",
          name: "Wrapped Ether",
          decimals: 18,
        },
      },
      { source: "scanner" },
    );
    const second = createEvent(
      "risk.assessed",
      { chainId: 8453, token: WETH, risk: { score: 10, verdict: "safe", factors: [] } },
      { source: "shield", correlationId: first.correlationId },
    );
    expect(second.correlationId).toBe(first.correlationId);
  });
});

describe("parseEvent", () => {
  it("rejects malformed and unknown events", () => {
    expect(() => parseEvent({ type: "token.detected" })).toThrow(ValidationError);
    expect(() => parseEvent({ type: "nope.unknown", id: "x" })).toThrow(ValidationError);
    expect(() => parseEvent(null)).toThrow(ValidationError);
  });
});

describe("serialize / deserialize", () => {
  it("round-trips through the wire form, preserving bigint amounts", () => {
    const event = createEvent(
      "trade.executed",
      {
        trade: {
          id: "t1",
          chainId: 8453,
          side: "buy",
          token: WETH,
          amountIn: tokenAmount(1_000_000_000_000_000_000n, 18),
          amountOut: tokenAmount(500n, 6),
          txHash: `0x${"a".repeat(64)}`,
          simulated: false,
        },
      },
      { source: "engine" },
    );

    const wire = serializeEvent(event);
    expect(typeof wire).toBe("string");

    const back = deserializeEvent(wire);
    if (back.type !== "trade.executed") {
      throw new Error(`unexpected event type: ${back.type}`);
    }
    expect(back.payload.trade.amountIn.raw).toBe(1_000_000_000_000_000_000n);
    expect(typeof back.payload.trade.amountIn.raw).toBe("bigint");
    expect(back.payload.trade.txHash).toBe(event.payload.trade.txHash);
  });
});
