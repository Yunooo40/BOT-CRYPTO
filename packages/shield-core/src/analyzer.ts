import { asHex } from "@bot/dex-adapters";
import {
  SUPPORTED_CHAINS,
  type Address,
  type ChainId,
  type Pool,
  type RiskFactor,
  type RiskScore,
  type RiskVerdict,
} from "@bot/domain";
import { createLogger, type Logger } from "@bot/logger";
import { defaultDetectors } from "./detectors";
import {
  INDETERMINATE_SCORE,
  type Detector,
  type DetectorContext,
  type ShieldClient,
} from "./detector";

export interface AnalyzeParams {
  token: Address;
  quoteToken: Address;
  pool?: Pool;
}

export interface RiskThresholds {
  /** score < safe → "safe"; < caution → "caution"; else "danger". */
  safe: number;
  caution: number;
}

export interface ShieldAnalyzerOptions {
  client: ShieldClient;
  detectors?: Detector[];
  logger?: Logger;
  chainId?: ChainId;
  /** Per-detector timeout. Default 2 500 ms (full) — the gate tightens it. */
  detectorTimeoutMs?: number;
  /** Tighter per-detector timeout for the fast gate. Default 250 ms. */
  fastDetectorTimeoutMs?: number;
  thresholds?: RiskThresholds;
  /** Quick-assessment cache TTL, keyed by token. Default 30 000 ms. */
  cacheTtlMs?: number;
  now?: () => number;
}

function verdictOf(score: number, thresholds: RiskThresholds): RiskVerdict {
  if (score < thresholds.safe) return "safe";
  if (score < thresholds.caution) return "caution";
  return "danger";
}

/** Run a detector under a timeout; any failure becomes an indeterminate factor. */
async function runDetector(
  detector: Detector,
  ctx: DetectorContext,
  timeoutMs: number,
): Promise<RiskFactor> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`detector ${detector.name} timed out`)), timeoutMs);
    timer.unref?.();
  });
  try {
    const partial = await Promise.race([detector.detect(ctx), timeout]);
    return { detector: detector.name, weight: detector.weight, ...partial };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    return {
      detector: detector.name,
      weight: detector.weight,
      score: INDETERMINATE_SCORE,
      detail: `indeterminate: ${reason}`,
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

interface CacheEntry {
  risk: RiskScore;
  expiresAt: number;
}

/**
 * The Rugpull Shield core. Two speeds, per the architecture:
 * - `assessQuick` runs only the cheap `fast` detectors under a tight timeout
 *   and caches by token — the pre-trade gate.
 * - `assess` runs all detectors — the full asynchronous analysis.
 *
 * The verdict is always *explained*: every `RiskScore.factors` entry carries
 * the detector's score and a human detail. A failing or slow detector yields
 * an indeterminate factor (moderate score), never a crash or a false `safe`.
 */
export class ShieldAnalyzer {
  readonly #client: ShieldClient;
  readonly #detectors: Detector[];
  readonly #logger: Logger;
  readonly #chainId: ChainId;
  readonly #timeoutMs: number;
  readonly #fastTimeoutMs: number;
  readonly #thresholds: RiskThresholds;
  readonly #cacheTtlMs: number;
  readonly #now: () => number;
  readonly #quickCache = new Map<Address, CacheEntry>();

  constructor(options: ShieldAnalyzerOptions) {
    this.#client = options.client;
    this.#detectors = options.detectors ?? defaultDetectors();
    this.#logger = options.logger ?? createLogger({ name: "shield" });
    this.#chainId = options.chainId ?? SUPPORTED_CHAINS.base;
    this.#timeoutMs = options.detectorTimeoutMs ?? 2_500;
    this.#fastTimeoutMs = options.fastDetectorTimeoutMs ?? 250;
    this.#thresholds = options.thresholds ?? { safe: 30, caution: 60 };
    this.#cacheTtlMs = options.cacheTtlMs ?? 30_000;
    this.#now = options.now ?? Date.now;
  }

  /** Fast pre-trade gate: `fast` detectors only, tight timeout, cached. */
  async assessQuick(params: AnalyzeParams): Promise<RiskScore> {
    const cached = this.#quickCache.get(params.token);
    if (cached !== undefined && cached.expiresAt > this.#now()) {
      return cached.risk;
    }
    const risk = await this.#run(
      params,
      this.#detectors.filter((detector) => detector.fast),
      this.#fastTimeoutMs,
    );
    this.#quickCache.set(params.token, { risk, expiresAt: this.#now() + this.#cacheTtlMs });
    return risk;
  }

  /** Full analysis: all detectors. */
  async assess(params: AnalyzeParams): Promise<RiskScore> {
    return this.#run(params, this.#detectors, this.#timeoutMs);
  }

  async #run(params: AnalyzeParams, detectors: Detector[], timeoutMs: number): Promise<RiskScore> {
    const bytecode = await this.#client
      .getCode({ address: asHex(params.token) })
      .then((code) => code ?? "0x")
      .catch(() => "0x" as const);
    const ctx: DetectorContext = {
      chainId: this.#chainId,
      token: params.token,
      quoteToken: params.quoteToken,
      ...(params.pool !== undefined ? { pool: params.pool } : {}),
      bytecode,
      client: this.#client,
    };
    const factors = await Promise.all(
      detectors.map((detector) => runDetector(detector, ctx, timeoutMs)),
    );
    const score = aggregate(factors);
    const verdict = verdictOf(score, this.#thresholds);
    this.#logger.info(
      { token: params.token, score, verdict, detectors: detectors.length },
      "risk assessed",
    );
    return { score, verdict, factors };
  }
}

/** Weighted average of factor scores, normalized by the weights actually run. */
export function aggregate(factors: RiskFactor[]): number {
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  if (totalWeight === 0) {
    return 0;
  }
  const weighted = factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0);
  return Math.round((weighted / totalWeight) * 100) / 100;
}
