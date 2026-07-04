import { asHex, BASE_WETH } from "@bot/dex-adapters";
import { SUPPORTED_CHAINS, type Address, type ChainId, type Dex, type Pool } from "@bot/domain";
import { createEvent, type EventBus } from "@bot/events";
import { createLogger, type Logger } from "@bot/logger";
import { readTokenMetadata } from "./enrich";
import type { ScanCursorStore, ScannerClient, SeenPoolStore } from "./ports";
import { defaultVenueSources, type VenueSource } from "./sources";

const balanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface ScannerStats {
  poolsSeen: number;
  poolsPublished: number;
  errors: number;
}

export interface ScannerOptions {
  client: ScannerClient;
  bus: EventBus;
  cursors: ScanCursorStore;
  seen: SeenPoolStore;
  /** Factories to watch. Defaults to Uniswap V2/V3 + Aerodrome on Base. */
  sources?: VenueSource[];
  logger?: Logger;
  chainId?: ChainId;
  /** Delay between polls once caught up with the head. Default 1 500 ms. */
  pollIntervalMs?: number;
  /** Max blocks per `eth_getLogs` (RPC providers cap ranges). Default 2 000. */
  maxBlockRange?: number;
  /** Blocks behind head to scan (cheap reorg guard). Default 1. */
  confirmations?: number;
  /**
   * Only publish pools paired with one of these tokens (WETH by default —
   * where memecoins launch). Pass `[]` to publish every pool.
   */
  quoteTokens?: Address[];
  /**
   * Optional: minimum quote-token balance held by the pool *at detection
   * time*. Off by default — many launches add liquidity after creation.
   */
  minQuoteLiquidity?: bigint;
}

/**
 * Polls the DEX factories for pool-creation events and feeds the platform:
 * one `pool.created` + one `token.detected` (correlated) per new pool.
 * Per-venue persistent cursors resume cleanly after a restart; a seen-set
 * dedupes replays and reorg overlaps; RPC errors back off and retry — the
 * pool of `@bot/rpc-manager` underneath already failed over before we hear
 * about an error.
 */
export class Scanner {
  readonly #client: ScannerClient;
  readonly #bus: EventBus;
  readonly #cursors: ScanCursorStore;
  readonly #seen: SeenPoolStore;
  readonly #sources: VenueSource[];
  readonly #logger: Logger;
  readonly #chainId: ChainId;
  readonly #pollIntervalMs: number;
  readonly #maxBlockRange: bigint;
  readonly #confirmations: bigint;
  readonly #quoteTokens: Address[];
  readonly #minQuoteLiquidity: bigint | undefined;

  readonly #timers = new Map<Dex, NodeJS.Timeout>();
  readonly #backoffMs = new Map<Dex, number>();
  #running = false;
  readonly #stats: ScannerStats = { poolsSeen: 0, poolsPublished: 0, errors: 0 };

  constructor(options: ScannerOptions) {
    this.#client = options.client;
    this.#bus = options.bus;
    this.#cursors = options.cursors;
    this.#seen = options.seen;
    this.#sources = options.sources ?? defaultVenueSources();
    this.#logger = options.logger ?? createLogger({ name: "scanner" });
    this.#chainId = options.chainId ?? SUPPORTED_CHAINS.base;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_500;
    this.#maxBlockRange = BigInt(options.maxBlockRange ?? 2_000);
    this.#confirmations = BigInt(options.confirmations ?? 1);
    this.#quoteTokens = options.quoteTokens ?? [BASE_WETH];
    this.#minQuoteLiquidity = options.minQuoteLiquidity;
  }

  stats(): ScannerStats {
    return { ...this.#stats };
  }

  /** Start one polling loop per venue (idempotent). */
  start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;
    for (const source of this.#sources) {
      this.#schedule(source, 0);
    }
  }

  /** Stop all polling loops (idempotent). In-flight ticks finish on their own. */
  stop(): void {
    this.#running = false;
    for (const timer of this.#timers.values()) {
      clearTimeout(timer);
    }
    this.#timers.clear();
  }

  /**
   * Scan exactly one block range for every venue. This is the deterministic
   * unit the loops repeat — and what tests drive directly.
   */
  async tickOnce(): Promise<void> {
    for (const source of this.#sources) {
      await this.#scanRange(source);
    }
  }

  #schedule(source: VenueSource, delayMs: number): void {
    if (!this.#running) {
      return;
    }
    const timer = setTimeout(() => {
      void this.#runTick(source);
    }, delayMs);
    timer.unref?.();
    this.#timers.set(source.dex, timer);
  }

  async #runTick(source: VenueSource): Promise<void> {
    try {
      const { caughtUp } = await this.#scanRange(source);
      this.#backoffMs.delete(source.dex);
      // Behind the head: chew through the backlog without waiting.
      this.#schedule(source, caughtUp ? this.#pollIntervalMs : 0);
    } catch (error) {
      this.#stats.errors += 1;
      const backoff = Math.min(
        (this.#backoffMs.get(source.dex) ?? this.#pollIntervalMs) * 2,
        30_000,
      );
      this.#backoffMs.set(source.dex, backoff);
      this.#logger.warn({ err: error, dex: source.dex, backoffMs: backoff }, "scan tick failed");
      this.#schedule(source, backoff);
    }
  }

  async #scanRange(source: VenueSource): Promise<{ caughtUp: boolean }> {
    const head = await this.#client.getBlockNumber();
    const safeHead = head - this.#confirmations;
    const cursor = await this.#cursors.get(source.dex);
    if (cursor === undefined) {
      // First run: start at the current head — the scanner watches for *new*
      // pools; history is not its job.
      await this.#cursors.set(source.dex, safeHead);
      return { caughtUp: true };
    }
    if (safeHead <= cursor) {
      return { caughtUp: true };
    }
    const fromBlock = cursor + 1n;
    const maxTo = cursor + this.#maxBlockRange;
    const toBlock = safeHead < maxTo ? safeHead : maxTo;
    const logs = await this.#client.getLogs({
      address: asHex(source.factory),
      event: source.event,
      fromBlock,
      toBlock,
      strict: true,
    });
    for (const log of logs) {
      await this.#handleLog(source, (log as { args: Record<string, unknown> }).args);
    }
    await this.#cursors.set(source.dex, toBlock);
    return { caughtUp: toBlock >= safeHead };
  }

  async #handleLog(source: VenueSource, args: Record<string, unknown>): Promise<void> {
    const pool = source.toPool(args, this.#chainId);
    if (pool === undefined) {
      return;
    }
    this.#stats.poolsSeen += 1;
    if (await this.#seen.has(pool.address)) {
      return;
    }
    const quote = this.#quoteOf(pool);
    if (this.#quoteTokens.length > 0 && quote === undefined) {
      // Irrelevant pairing (no reference token): remember it, stay silent.
      await this.#seen.add(pool.address);
      return;
    }
    if (this.#minQuoteLiquidity !== undefined && quote !== undefined) {
      const balance = await this.#quoteBalance(quote, pool.address);
      if (balance < this.#minQuoteLiquidity) {
        // Not marked seen: a restart replaying this range gives it a second
        // look — the creation event itself will never fire again.
        return;
      }
    }
    // Enrich the launched token — the non-quote side of the pair.
    const tokenAddress =
      quote === undefined ? pool.token0 : quote === pool.token0 ? pool.token1 : pool.token0;
    const token = await readTokenMetadata(this.#client, tokenAddress, this.#chainId);
    const poolEvent = createEvent("pool.created", { pool }, { source: "scanner" });
    await this.#bus.publish(poolEvent);
    await this.#bus.publish(
      createEvent(
        "token.detected",
        { token, pool },
        { source: "scanner", correlationId: poolEvent.correlationId },
      ),
    );
    await this.#seen.add(pool.address);
    this.#stats.poolsPublished += 1;
    this.#logger.info(
      { dex: pool.dex, pool: pool.address, token: token.address, symbol: token.symbol },
      "new pool detected",
    );
  }

  #quoteOf(pool: Pool): Address | undefined {
    if (this.#quoteTokens.includes(pool.token0)) {
      return pool.token0;
    }
    if (this.#quoteTokens.includes(pool.token1)) {
      return pool.token1;
    }
    return undefined;
  }

  async #quoteBalance(quote: Address, pool: Address): Promise<bigint> {
    try {
      return await this.#client.readContract({
        address: asHex(quote),
        abi: balanceOfAbi,
        functionName: "balanceOf",
        args: [asHex(pool)],
      });
    } catch {
      return 0n;
    }
  }
}
