import { InfraError } from "@bot/errors";
import { createLogger } from "@bot/logger";
import { describe, expect, it, vi } from "vitest";
import { NotificationDispatcher } from "./dispatcher";
import type { NotificationChannel, NotificationMessage, Notifier } from "./message";

const silent = createLogger({ destination: { write: () => {} } });
const noSleep = async () => {};

function msg(overrides: Partial<NotificationMessage> = {}): NotificationMessage {
  return { title: "T", body: "B", severity: "success", ...overrides };
}

function spyNotifier(channel: NotificationChannel, impl?: Notifier["send"]): Notifier {
  return { channel, send: vi.fn(impl ?? (async () => {})) };
}

describe("NotificationDispatcher", () => {
  it("routes to channels meeting the rule's severity", async () => {
    const tg = spyNotifier("telegram");
    const dispatcher = new NotificationDispatcher({
      notifiers: [tg],
      logger: silent,
      sleep: noSleep,
    });
    const sent = await dispatcher.dispatch(msg({ severity: "success" }), {
      channels: ["telegram"],
      minSeverity: "warning",
    });
    expect(sent).toEqual([]); // success < warning
    expect(tg.send).not.toHaveBeenCalled();

    const sent2 = await dispatcher.dispatch(msg({ severity: "critical" }), {
      channels: ["telegram"],
      minSeverity: "warning",
    });
    expect(sent2).toEqual(["telegram"]);
  });

  it("dedupes identical dedupeKeys within the TTL", async () => {
    const tg = spyNotifier("telegram");
    const clock = { t: 0 };
    const dispatcher = new NotificationDispatcher({
      notifiers: [tg],
      logger: silent,
      dedupeTtlMs: 1_000,
      now: () => clock.t,
      sleep: noSleep,
    });
    const m = msg({ dedupeKey: "k1" });
    await dispatcher.dispatch(m);
    await dispatcher.dispatch(m);
    expect(tg.send).toHaveBeenCalledTimes(1);
    clock.t = 1_001;
    await dispatcher.dispatch(m);
    expect(tg.send).toHaveBeenCalledTimes(2);
  });

  it("rate-limits per channel via a token bucket", async () => {
    const tg = spyNotifier("telegram");
    const clock = { t: 0 };
    const dispatcher = new NotificationDispatcher({
      notifiers: [tg],
      logger: silent,
      rateLimit: 2,
      rateWindowMs: 1_000,
      now: () => clock.t,
      sleep: noSleep,
    });
    for (let i = 0; i < 4; i += 1) {
      await dispatcher.dispatch(msg()); // no dedupeKey → all distinct
    }
    expect(tg.send).toHaveBeenCalledTimes(2); // bucket of 2
    clock.t = 1_001;
    await dispatcher.dispatch(msg());
    expect(tg.send).toHaveBeenCalledTimes(3); // refilled
  });

  it("retries an InfraError send then succeeds", async () => {
    let calls = 0;
    const tg = spyNotifier("telegram", async () => {
      calls += 1;
      if (calls < 2) throw new InfraError("503");
    });
    const dispatcher = new NotificationDispatcher({
      notifiers: [tg],
      logger: silent,
      maxRetries: 2,
      sleep: noSleep,
    });
    const sent = await dispatcher.dispatch(msg());
    expect(sent).toEqual(["telegram"]);
    expect(calls).toBe(2);
  });

  it("does not retry a non-infra error and isolates channel failures", async () => {
    const bad = spyNotifier("telegram", async () => {
      throw new Error("400 bad request");
    });
    const good = spyNotifier("discord");
    const dispatcher = new NotificationDispatcher({
      notifiers: [bad, good],
      logger: silent,
      sleep: noSleep,
    });
    const sent = await dispatcher.dispatch(msg(), {
      channels: ["telegram", "discord"],
      minSeverity: "info",
    });
    expect(bad.send).toHaveBeenCalledTimes(1); // no retry
    expect(sent).toEqual(["discord"]); // good channel still delivered
  });
});
