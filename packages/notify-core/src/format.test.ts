import { createEvent } from "@bot/events";
import { toAddress, tokenAmount } from "@bot/domain";
import { describe, expect, it } from "vitest";
import { formatEvent } from "./format";

const TOKEN = toAddress("0x9999999999999999999999999999999999999999");
const TX = `0x${"a".repeat(64)}` as const;

describe("formatEvent", () => {
  it("maps trade.executed to a success message with an explorer link", () => {
    const event = createEvent(
      "trade.executed",
      {
        trade: {
          id: "t1",
          chainId: 8453,
          side: "buy",
          token: TOKEN,
          amountIn: tokenAmount(1_000n, 0),
          amountOut: tokenAmount(2_000n, 0),
          txHash: TX,
          simulated: false,
        },
      },
      { source: "engine" },
    );
    const msg = formatEvent(event);
    expect(msg?.severity).toBe("success");
    expect(msg?.link).toBe(`https://basescan.org/tx/${TX}`);
    expect(msg?.dedupeKey).toBe("trade.executed:t1");
  });

  it("marks a paper trade in the title", () => {
    const event = createEvent(
      "trade.executed",
      {
        trade: {
          id: "t2",
          chainId: 8453,
          side: "sell",
          token: TOKEN,
          amountIn: tokenAmount(1n, 0),
          amountOut: tokenAmount(1n, 0),
          txHash: TX,
          simulated: true,
        },
      },
      { source: "engine" },
    );
    expect(formatEvent(event)?.title).toContain("(paper)");
  });

  it("escalates trade.failed severity by retryable flag", () => {
    const base = {
      intent: {
        chainId: 8453 as const,
        side: "buy" as const,
        token: TOKEN,
        amountIn: tokenAmount(1n, 0),
        maxSlippageBps: 100,
        simulated: false,
      },
      reason: "slippage",
    };
    const retryable = createEvent(
      "trade.failed",
      { ...base, retryable: true },
      { source: "engine" },
    );
    const terminal = createEvent(
      "trade.failed",
      { ...base, retryable: false },
      { source: "engine" },
    );
    expect(formatEvent(retryable)?.severity).toBe("warning");
    expect(formatEvent(terminal)?.severity).toBe("critical");
  });

  it("notifies only on a danger risk verdict", () => {
    const danger = createEvent(
      "risk.assessed",
      {
        chainId: 8453,
        token: TOKEN,
        risk: {
          score: 80,
          verdict: "danger",
          factors: [{ detector: "honeypot-sell", score: 70, weight: 0.2, detail: "x" }],
        },
      },
      { source: "shield" },
    );
    const safe = createEvent(
      "risk.assessed",
      { chainId: 8453, token: TOKEN, risk: { score: 10, verdict: "safe", factors: [] } },
      { source: "shield" },
    );
    expect(formatEvent(danger)?.severity).toBe("critical");
    expect(formatEvent(safe)).toBeUndefined();
  });

  it("returns undefined for event types that don't notify", () => {
    const event = createEvent(
      "buy.requested",
      {
        intent: {
          chainId: 8453,
          side: "buy",
          token: TOKEN,
          amountIn: tokenAmount(1n, 0),
          maxSlippageBps: 100,
          simulated: false,
        },
      },
      { source: "strategy" },
    );
    expect(formatEvent(event)).toBeUndefined();
  });
});
