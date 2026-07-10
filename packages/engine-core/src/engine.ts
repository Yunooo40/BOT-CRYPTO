import type { Pool, RiskScore, RiskVerdict, Trade, TradeIntent } from "@bot/domain";
import { InfraError } from "@bot/errors";
import { createLogger, type Logger } from "@bot/logger";
import type { Executor, PositionRecord, PositionStore } from "./ports";
import { applyTrade } from "./positions";

/** Optional pre-trade gate — e.g. the Shield's quick assessment on a buy. */
export type PreTradeCheck = (intent: TradeIntent, pool: Pool) => Promise<RiskScore | undefined>;

/** Severity ordering of Shield verdicts, least → most dangerous. */
const VERDICT_SEVERITY: Record<RiskVerdict, number> = { safe: 0, caution: 1, danger: 2 };

export interface TradingEngineOptions {
  executor: Executor;
  positions: PositionStore;
  logger?: Logger;
  /**
   * Optional gate run before a buy. A verdict at or above `rejectAtOrAbove`
   * aborts the trade. Left unset by default so the engine core doesn't
   * hard-couple to the Shield — the app wires it in.
   */
  preTradeCheck?: PreTradeCheck;
  /**
   * Lowest Shield verdict that rejects a buy. Default `"danger"` (reject only
   * outright-dangerous tokens); set `"caution"` to also reject the grey zone.
   */
  rejectAtOrAbove?: RiskVerdict;
  /** Retryable-error attempts (total tries = retries + 1). Default 3. */
  maxRetries?: number;
  /** Base backoff between retries, doubled each attempt. Default 250 ms. */
  retryBackoffMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface TradeResult {
  status: "executed" | "rejected" | "failed";
  trade?: Trade;
  position?: PositionRecord;
  reason?: string;
  retryable?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Orchestrates a single trade: optional pre-trade gate → execute (paper or
 * live, it doesn't know which) → fold into the position book. Infrastructure
 * errors are retried with bounded backoff; domain errors (slippage, revert,
 * honeypot) are terminal. Idempotent by `intentId` — a replayed intent returns
 * the first result without re-executing.
 */
export class TradingEngine {
  readonly #executor: Executor;
  readonly #positions: PositionStore;
  readonly #logger: Logger;
  readonly #preTradeCheck: PreTradeCheck | undefined;
  readonly #rejectSeverity: number;
  readonly #maxRetries: number;
  readonly #backoffMs: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #done = new Map<string, TradeResult>();

  constructor(options: TradingEngineOptions) {
    this.#executor = options.executor;
    this.#positions = options.positions;
    this.#logger = options.logger ?? createLogger({ name: "engine" });
    this.#preTradeCheck = options.preTradeCheck;
    this.#rejectSeverity = VERDICT_SEVERITY[options.rejectAtOrAbove ?? "danger"];
    this.#maxRetries = options.maxRetries ?? 3;
    this.#backoffMs = options.retryBackoffMs ?? 250;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  get mode(): "paper" | "live" {
    return this.#executor.mode;
  }

  async trade(intent: TradeIntent, pool: Pool, intentId: string): Promise<TradeResult> {
    const cached = this.#done.get(intentId);
    if (cached !== undefined) {
      return cached;
    }

    if (intent.side === "buy" && this.#preTradeCheck !== undefined) {
      const risk = await this.#preTradeCheck(intent, pool);
      if (risk !== undefined && VERDICT_SEVERITY[risk.verdict] >= this.#rejectSeverity) {
        const result: TradeResult = {
          status: "rejected",
          reason: `pre-trade risk gate: ${risk.verdict} (score ${risk.score})`,
          retryable: false,
        };
        this.#done.set(intentId, result);
        return result;
      }
    }

    const result = await this.#executeWithRetry(intent, pool, intentId);
    this.#done.set(intentId, result);
    return result;
  }

  async #executeWithRetry(intent: TradeIntent, pool: Pool, intentId: string): Promise<TradeResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      try {
        const trade = await this.#executor.execute({ intent, pool, intentId });
        const position = await applyTrade(this.#positions, trade, this.#now);
        this.#logger.info(
          {
            intentId,
            side: intent.side,
            token: intent.token,
            txHash: trade.txHash,
            mode: this.mode,
          },
          "trade executed",
        );
        return { status: "executed", trade, ...(position !== undefined ? { position } : {}) };
      } catch (error) {
        lastError = error;
        const retryable = error instanceof InfraError;
        if (!retryable || attempt === this.#maxRetries) {
          const reason = error instanceof Error ? error.message : "unknown error";
          this.#logger.warn({ intentId, err: error, retryable }, "trade failed");
          return { status: "failed", reason, retryable };
        }
        await this.#sleep(this.#backoffMs * 2 ** attempt);
      }
    }
    // Unreachable: the loop always returns. Kept for exhaustiveness.
    const reason = lastError instanceof Error ? lastError.message : "unknown error";
    return { status: "failed", reason, retryable: true };
  }
}
