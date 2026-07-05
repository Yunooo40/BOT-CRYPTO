import { tokenAmount, toAddress } from "@bot/domain";
import { createEvent, InMemoryEventBus } from "@bot/events";
import { createLogger } from "@bot/logger";
import { describe, expect, it, vi } from "vitest";
import { attachNotifications } from "./bus";
import { NotificationDispatcher } from "./dispatcher";
import type { Notifier } from "./message";

const silent = createLogger({ destination: { write: () => {} } });
const TOKEN = toAddress("0x9999999999999999999999999999999999999999");

describe("attachNotifications", () => {
  it("formats a trade.executed event and dispatches it to a channel", async () => {
    const bus = new InMemoryEventBus({ logger: silent });
    const notifier: Notifier = { channel: "telegram", send: vi.fn(async () => {}) };
    const dispatcher = new NotificationDispatcher({
      notifiers: [notifier],
      logger: silent,
      sleep: async () => {},
    });
    await attachNotifications({ bus, dispatcher, logger: silent });

    await bus.publish(
      createEvent(
        "trade.executed",
        {
          trade: {
            id: "t1",
            chainId: 8453,
            side: "buy",
            token: TOKEN,
            amountIn: tokenAmount(1n, 0),
            amountOut: tokenAmount(2n, 0),
            txHash: `0x${"a".repeat(64)}`,
            simulated: true,
          },
        },
        { source: "engine" },
      ),
    );

    expect(notifier.send).toHaveBeenCalledOnce();
    const sentMsg = (notifier.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sentMsg).toMatchObject({ severity: "success" });
  });

  it("ignores events with no notification mapping (non-danger risk)", async () => {
    const bus = new InMemoryEventBus({ logger: silent });
    const notifier: Notifier = { channel: "discord", send: vi.fn(async () => {}) };
    const dispatcher = new NotificationDispatcher({ notifiers: [notifier], logger: silent });
    await attachNotifications({ bus, dispatcher, logger: silent });

    await bus.publish(
      createEvent(
        "risk.assessed",
        { chainId: 8453, token: TOKEN, risk: { score: 5, verdict: "safe", factors: [] } },
        { source: "shield" },
      ),
    );
    expect(notifier.send).not.toHaveBeenCalled();
  });
});
