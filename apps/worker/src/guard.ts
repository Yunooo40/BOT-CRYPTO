import type { Trade } from "@bot/domain";
import type { ExecuteRequest, Executor, PositionStore } from "@bot/engine-core";
import { DomainError } from "@bot/errors";

/** Thrown when a buy's notional exceeds the configured live cap. Terminal. */
export class NotionalCapExceededError extends DomainError {}

/** Thrown when a buy would breach a portfolio-level limit. Terminal. */
export class PortfolioLimitExceededError extends DomainError {}

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

/** Portfolio-level ceilings enforced before a buy. A zero disables that limit. */
export interface PortfolioLimits {
  /** Max distinct open positions held at once. 0 = unlimited. */
  maxOpenPositions: number;
  /** Max total quote deployed across open positions, base units. 0 = unlimited. */
  maxTotalNotionalWei: bigint;
}

/**
 * Wraps an executor with portfolio-level risk ceilings, checked before every
 * buy against the open positions in the store: a cap on how many positions can
 * be open at once, and a cap on the total quote deployed across them. Without
 * this a burst of fresh pools makes the sniper open an unbounded number of
 * positions with unbounded total capital — the single largest live-money risk.
 *
 * Only the book matching the intent (`simulated`) is considered, so paper and
 * live exposure are counted independently. Adding to a token already held never
 * trips the position-count cap (it opens no new slot). Breaches throw a terminal
 * `DomainError` the engine treats as non-retryable, so an over-limit buy is
 * skipped cleanly rather than looping.
 */
export function withPortfolioLimits(
  executor: Executor,
  positions: Pick<PositionStore, "list">,
  limits: PortfolioLimits,
): Executor {
  return {
    mode: executor.mode,
    async execute(request: ExecuteRequest): Promise<Trade> {
      const { intent, intentId } = request;
      if (intent.side !== "buy") {
        return executor.execute(request); // sells only reduce exposure
      }
      if (limits.maxOpenPositions <= 0 && limits.maxTotalNotionalWei <= 0n) {
        return executor.execute(request); // both limits disabled
      }

      const open = (await positions.list()).filter(
        (record) => record.simulated === intent.simulated && record.amount > 0n,
      );

      const tokenKey = intent.token.toLowerCase();
      const isNewPosition = !open.some((record) => record.token.toLowerCase() === tokenKey);
      if (limits.maxOpenPositions > 0 && isNewPosition && open.length >= limits.maxOpenPositions) {
        throw new PortfolioLimitExceededError(
          `Open positions ${open.length} at cap ${limits.maxOpenPositions}`,
          {
            context: {
              intentId,
              token: intent.token,
              openPositions: open.length,
              maxOpenPositions: limits.maxOpenPositions,
            },
          },
        );
      }

      if (limits.maxTotalNotionalWei > 0n) {
        const deployed = open.reduce((sum, record) => sum + record.costBasis, 0n);
        if (deployed + intent.amountIn.raw > limits.maxTotalNotionalWei) {
          throw new PortfolioLimitExceededError(
            `Deployed ${deployed} + ${intent.amountIn.raw} exceeds total cap ${limits.maxTotalNotionalWei}`,
            {
              context: {
                intentId,
                token: intent.token,
                deployed: deployed.toString(),
                amountIn: intent.amountIn.raw.toString(),
                maxTotalNotionalWei: limits.maxTotalNotionalWei.toString(),
              },
            },
          );
        }
      }

      return executor.execute(request);
    },
  };
}
