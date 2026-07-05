import { BASE_WETH } from "@bot/dex-adapters";
import { createEvent, type EventBus, type Unsubscribe } from "@bot/events";
import { createLogger, type Logger } from "@bot/logger";
import type { ShieldAnalyzer } from "./analyzer";

export interface AttachShieldOptions {
  bus: EventBus;
  analyzer: ShieldAnalyzer;
  logger?: Logger;
  /** Consumer group on the bus. Default "shield". */
  group?: string;
  /**
   * Which assessment to publish on detection. "full" (default) runs the 11
   * detectors; "quick" runs the fast gate — the Engine can request either.
   */
  mode?: "full" | "quick";
}

/**
 * Wire the Shield onto the bus: subscribe to `token.detected`, run the
 * analysis, publish `risk.assessed` with the same correlation id so the whole
 * detect → assess flow stays traceable. Returns the unsubscribe handle.
 */
export async function attachShield(options: AttachShieldOptions): Promise<Unsubscribe> {
  const { bus, analyzer } = options;
  const logger = options.logger ?? createLogger({ name: "shield-bus" });
  const mode = options.mode ?? "full";

  return bus.subscribe(
    "token.detected",
    async (event) => {
      const { token, pool } = event.payload;
      const quoteToken =
        pool !== undefined
          ? pool.token0 === token.address
            ? pool.token1
            : pool.token0
          : BASE_WETH;
      const params = {
        token: token.address,
        quoteToken,
        ...(pool !== undefined ? { pool } : {}),
      };
      const risk =
        mode === "quick" ? await analyzer.assessQuick(params) : await analyzer.assess(params);
      await bus.publish(
        createEvent(
          "risk.assessed",
          { chainId: token.chainId, token: token.address, risk },
          { source: "shield", correlationId: event.correlationId },
        ),
      );
      logger.info(
        { token: token.address, score: risk.score, verdict: risk.verdict },
        "published risk.assessed",
      );
    },
    { group: options.group ?? "shield" },
  );
}
