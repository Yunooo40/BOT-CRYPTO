import { toAddress, tokenAmount } from "@bot/domain";
import { createEvent, InMemoryEventBus } from "@bot/events";
import { createLogger } from "@bot/logger";
import { describe, expect, it } from "vitest";
import { Auditor, auditRecordOf } from "./auditor";
import { InMemoryAuditSink } from "./record";

const TOKEN = toAddress("0x4200000000000000000000000000000000000006");
const silent = createLogger({ destination: { write: () => undefined } });

function executed() {
  return createEvent(
    "trade.executed",
    {
      trade: {
        id: "t1",
        chainId: 8453,
        side: "buy",
        token: TOKEN,
        amountIn: tokenAmount(1_000_000_000_000_000_000n, 18),
        amountOut: tokenAmount(500n, 6),
        txHash: `0x${"a".repeat(64)}`,
        simulated: false,
      },
    },
    { source: "engine" },
  );
}

function failed() {
  return createEvent(
    "trade.failed",
    {
      intent: {
        chainId: 8453,
        side: "sell",
        token: TOKEN,
        amountIn: tokenAmount(42n, 6),
        maxSlippageBps: 100,
        simulated: true,
      },
      reason: "slippage exceeded",
      retryable: false,
    },
    { source: "engine" },
  );
}

describe("auditRecordOf", () => {
  it("maps a trade.executed to a success record with bigints stringified", () => {
    const record = auditRecordOf(executed());
    expect(record).not.toBeNull();
    expect(record!.action).toBe("trade.executed");
    expect(record!.outcome).toBe("success");
    expect(record!.subject).toBe(TOKEN);
    expect(record!.detail.amountInRaw).toBe("1000000000000000000");
    expect(record!.detail.txHash).toBe(`0x${"a".repeat(64)}`);
    // Fully JSON-safe: no bigint survives into the record.
    expect(() => JSON.stringify(record)).not.toThrow();
  });

  it("maps a trade.failed to a failure record with the reason", () => {
    const record = auditRecordOf(failed());
    expect(record!.outcome).toBe("failure");
    expect(record!.detail.reason).toBe("slippage exceeded");
    expect(record!.detail.retryable).toBe(false);
  });

  it("returns null for a non-audited event", () => {
    const detected = createEvent(
      "token.detected",
      {
        token: { chainId: 8453, address: TOKEN, symbol: "W", name: "W", decimals: 18 },
      },
      { source: "scanner" },
    );
    expect(auditRecordOf(detected)).toBeNull();
  });
});

describe("Auditor", () => {
  it("writes a record when a money-moving event is published", async () => {
    const bus = new InMemoryEventBus({ logger: silent });
    const sink = new InMemoryAuditSink();
    const auditor = new Auditor({ bus, sink, logger: silent });
    await auditor.start();

    await bus.publish(executed());
    await bus.publish(failed());

    const records = sink.list();
    expect(records.map((r) => r.action)).toEqual(["trade.executed", "trade.failed"]);
    await auditor.stop();
  });

  it("stops writing after stop()", async () => {
    const bus = new InMemoryEventBus({ logger: silent });
    const sink = new InMemoryAuditSink();
    const auditor = new Auditor({ bus, sink, logger: silent });
    await auditor.start();
    await auditor.stop();

    await bus.publish(executed());
    expect(sink.list()).toHaveLength(0);
  });

  it("is idempotent on the event id (redelivery writes one row)", async () => {
    const sink = new InMemoryAuditSink();
    const event = executed();
    const record = auditRecordOf(event)!;
    await sink.record(record);
    await sink.record(record);
    expect(sink.list()).toHaveLength(1);
  });
});
