import { toAddress } from "@bot/domain";
import { createEvent } from "@bot/events";
import { createLogger } from "@bot/logger";
import { describe, expect, it } from "vitest";
import { AlertEngine, alertSignalsOf, type Alert } from "./engine";
import { alertToNotification } from "./notify";

const TOKEN = toAddress("0x4200000000000000000000000000000000000006");
const silent = createLogger({ destination: { write: () => undefined } });

function collector() {
  const alerts: Alert[] = [];
  return { alerts, dispatch: async (alert: Alert) => void alerts.push(alert) };
}

describe("alertSignalsOf", () => {
  it("emits a signal for a failed trade", () => {
    const event = createEvent(
      "trade.failed",
      {
        intent: {
          chainId: 8453,
          side: "buy",
          token: TOKEN,
          amountIn: { raw: 1n, decimals: 18 },
          maxSlippageBps: 100,
          simulated: false,
        },
        reason: "boom",
        retryable: true,
      },
      { source: "engine" },
    );
    expect(alertSignalsOf(event)).toEqual([{ key: "trade.failed", at: event.occurredAt }]);
  });

  it("emits a danger signal only for a danger verdict", () => {
    const danger = createEvent(
      "risk.assessed",
      { chainId: 8453, token: TOKEN, risk: { score: 90, verdict: "danger", factors: [] } },
      { source: "shield" },
    );
    const safe = createEvent(
      "risk.assessed",
      { chainId: 8453, token: TOKEN, risk: { score: 10, verdict: "safe", factors: [] } },
      { source: "shield" },
    );
    expect(alertSignalsOf(danger)).toHaveLength(1);
    expect(alertSignalsOf(safe)).toHaveLength(0);
  });
});

describe("AlertEngine", () => {
  const rule = {
    name: "spike",
    key: "trade.failed",
    windowMs: 1_000,
    threshold: 3,
    severity: "critical" as const,
    title: "Spike",
  };

  it("fires once the threshold is crossed within the window", async () => {
    const { alerts, dispatch } = collector();
    const clock = 0;
    const engine = new AlertEngine({ rules: [rule], dispatch, logger: silent, now: () => clock });

    await engine.record({ key: "trade.failed", at: 0 });
    await engine.record({ key: "trade.failed", at: 0 });
    expect(alerts).toHaveLength(0); // below threshold
    await engine.record({ key: "trade.failed", at: 0 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.count).toBe(3);
    expect(alerts[0]!.severity).toBe("critical");
  });

  it("does not fire when occurrences fall outside the window", async () => {
    const { alerts, dispatch } = collector();
    let clock = 0;
    const engine = new AlertEngine({ rules: [rule], dispatch, logger: silent, now: () => clock });

    await engine.record({ key: "trade.failed", at: 0 });
    await engine.record({ key: "trade.failed", at: 0 });
    clock = 5_000; // window is 1s; the two above have aged out
    await engine.record({ key: "trade.failed", at: 5_000 });
    expect(alerts).toHaveLength(0);
  });

  it("respects the cooldown between repeat firings", async () => {
    const { alerts, dispatch } = collector();
    let clock = 0;
    const engine = new AlertEngine({
      rules: [rule],
      dispatch,
      logger: silent,
      cooldownMs: 10_000,
      now: () => clock,
    });

    for (let i = 0; i < 3; i += 1) await engine.record({ key: "trade.failed", at: clock });
    expect(alerts).toHaveLength(1);

    // More failures immediately: still cooling down, no second alert.
    for (let i = 0; i < 3; i += 1) await engine.record({ key: "trade.failed", at: clock });
    expect(alerts).toHaveLength(1);

    // After the cooldown elapses, a fresh burst fires again.
    clock = 11_000;
    for (let i = 0; i < 3; i += 1) await engine.record({ key: "trade.failed", at: clock });
    expect(alerts).toHaveLength(2);
  });

  it("observeEvent bridges domain events to signals", async () => {
    const { alerts, dispatch } = collector();
    const engine = new AlertEngine({
      rules: [{ ...rule, threshold: 1 }],
      dispatch,
      logger: silent,
    });
    const event = createEvent(
      "trade.failed",
      {
        intent: {
          chainId: 8453,
          side: "sell",
          token: TOKEN,
          amountIn: { raw: 1n, decimals: 18 },
          maxSlippageBps: 100,
          simulated: false,
        },
        reason: "x",
        retryable: false,
      },
      { source: "engine" },
    );
    await engine.observeEvent(event);
    expect(alerts).toHaveLength(1);
  });

  it("swallows a dispatch failure so one bad channel can't wedge the engine", async () => {
    const engine = new AlertEngine({
      rules: [{ ...rule, threshold: 1 }],
      dispatch: async () => {
        throw new Error("channel down");
      },
      logger: silent,
    });
    await expect(engine.record({ key: "trade.failed", at: 0 })).resolves.toBeUndefined();
  });
});

describe("alertToNotification", () => {
  it("carries severity, dedupeKey and context fields", () => {
    const alert: Alert = {
      rule: "spike",
      severity: "critical",
      title: "Spike",
      body: "3 failures",
      count: 3,
      windowMs: 60_000,
      occurredAt: 1,
      dedupeKey: "spike",
    };
    const message = alertToNotification(alert);
    expect(message.severity).toBe("critical");
    expect(message.dedupeKey).toBe("spike");
    expect(message.fields).toEqual(expect.arrayContaining([{ label: "Rule", value: "spike" }]));
  });
});
