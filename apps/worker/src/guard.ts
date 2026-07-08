import type { Trade } from "@bot/domain";
import type { ExecuteRequest, Executor } from "@bot/engine-core";
import { DomainError } from "@bot/errors";

/** Thrown when a buy's notional exceeds the configured live cap. Terminal. */
export class NotionalCapExceededError extends DomainError {}

/**
 * Wraps an executor with a hard per-trade notional cap on the quote spent by a
 * buy. A safety rail for live mode: a mis-sized rule (or a bug) can't spend
 * more than `maxNotional` base units of the quote asset in a single trade. It
 * throws a `DomainError`, which the engine treats as terminal (no retry), so an
 * over-cap intent fails cleanly rather than looping.
 *
 * Only buys are capped — a sell's `amountIn` is denominated in the token being
 * sold, not the quote asset, so the notional cap doesn't apply.
 */
export function withNotionalCap(executor: Executor, maxNotional: bigint): Executor {
  return {
    mode: executor.mode,
    async execute(request: ExecuteRequest): Promise<Trade> {
      const { intent, intentId } = request;
      if (intent.side === "buy" && intent.amountIn.raw > maxNotional) {
        throw new NotionalCapExceededError(
          `Buy notional ${intent.amountIn.raw} exceeds live cap ${maxNotional}`,
          {
            context: {
              intentId,
              token: intent.token,
              amountIn: intent.amountIn.raw.toString(),
              maxNotional: maxNotional.toString(),
            },
          },
        );
      }
      return executor.execute(request);
    },
  };
}
