import { loadEnv, type Env } from "@bot/config";
import {
  BASE_USDC,
  BASE_WETH,
  counterToken,
  createDexAdapters,
  type ChainReader,
} from "@bot/dex-adapters";
import { SUPPORTED_CHAINS, type ChainId } from "@bot/domain";
import {
  AdapterRouter,
  attachEngine,
  DrizzlePositionStore,
  InMemoryPositionStore,
  LiveExecutor,
  PaperExecutor,
  TradingEngine,
  type Executor,
  type PositionStore,
} from "@bot/engine-core";
import { RedisEventBus, type Unsubscribe } from "@bot/events";
import { createLogger, type Logger } from "@bot/logger";
import { rpcEndpointsFromEnv, RpcPool } from "@bot/rpc-manager";
import { InMemoryScanState, Scanner } from "@bot/scanner-core";
import { ShieldAnalyzer, type ShieldClient } from "@bot/shield-core";
import {
  DrizzleStrategyStore,
  InMemoryStrategyStore,
  QuotePriceSource,
  StrategyRunner,
  type PositionSource,
  type StrategyStore,
} from "@bot/strategies-core";
import { DrizzleWalletRepository, WalletService } from "@bot/wallet-core";
import { Redis } from "ioredis";
import type { PublicClient } from "viem";
import { attachExitArmer, type ExitConfig } from "./exits.js";
import { withNotionalCap } from "./guard.js";
import { WalletServiceSigner, type SignerClient } from "./signer.js";
import { attachSniper, buildSnipeRule, PoolRegistry } from "./sniper.js";

function bigintEnv(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return BigInt(raw);
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireEnv(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`${name} is required for WORKER_MODE=live`);
  }
  return raw.trim();
}

type WorkerMode = "paper" | "live";

function resolveMode(): WorkerMode {
  const raw = (process.env.WORKER_MODE ?? "paper").toLowerCase();
  if (raw !== "paper" && raw !== "live") {
    throw new Error(`WORKER_MODE must be "paper" or "live", got "${raw}"`);
  }
  return raw;
}

/** Everything the execution path needs, resolved once per boot from the mode. */
interface ExecutionSetup {
  executor: Executor;
  positions: PositionStore;
  strategyStore: StrategyStore;
  /** Wallet the snipe buys / exit sells run against (`"paper"` in paper mode). */
  walletId: string;
  /** Paper vs live book — stamped onto every rule so the books line up. */
  simulated: boolean;
  cleanups: Array<() => Promise<void>>;
}

/**
 * Paper mode: quote-only execution, in-memory books, no key. Live mode: real
 * signatures via the Wallet Service behind a hard notional cap, and
 * Postgres-backed position/strategy books so a restart never drops an open
 * position or its stop-loss.
 *
 * Live is gated on purpose — WORKER_MODE=live is not enough. It also demands an
 * explicit WORKER_LIVE_CONFIRM=I_UNDERSTAND, a wallet id, a master key and a
 * per-trade cap, so a stray env var can never start spending real funds.
 */
async function setupExecution(params: {
  mode: WorkerMode;
  env: Env;
  router: AdapterRouter;
  client: PublicClient;
  chainId: ChainId;
  logger: Logger;
}): Promise<ExecutionSetup> {
  const { mode, env, router, client, chainId, logger } = params;

  if (mode === "paper") {
    return {
      executor: new PaperExecutor({ router }),
      positions: new InMemoryPositionStore(),
      strategyStore: new InMemoryStrategyStore(),
      walletId: "paper",
      simulated: true,
      cleanups: [],
    };
  }

  // --- Live: fail fast unless every safety gate is satisfied ---
  if (requireEnv("WORKER_LIVE_CONFIRM") !== "I_UNDERSTAND") {
    throw new Error('WORKER_LIVE_CONFIRM must equal "I_UNDERSTAND" to run live');
  }
  const walletId = requireEnv("WORKER_WALLET_ID");
  const maxNotionalWei = BigInt(requireEnv("WORKER_MAX_NOTIONAL_WEI"));
  if (maxNotionalWei <= 0n) {
    throw new Error("WORKER_MAX_NOTIONAL_WEI must be a positive integer (quote base units)");
  }
  if (env.WALLET_MASTER_KEY === undefined) {
    throw new Error("WALLET_MASTER_KEY is required for WORKER_MODE=live");
  }

  const wallet = DrizzleWalletRepository.connect(env.DATABASE_URL);
  const positions = DrizzlePositionStore.connect(env.DATABASE_URL);
  const strategies = DrizzleStrategyStore.connect(env.DATABASE_URL);
  const cleanups = [wallet.close, positions.close, strategies.close];

  const walletService = new WalletService({
    repository: wallet.repository,
    masterKey: env.WALLET_MASTER_KEY,
  });
  const info = await walletService.getWallet(walletId); // throws if the id is unknown

  const signer = new WalletServiceSigner({
    signer: walletService,
    walletId,
    address: info.address,
    client: client as SignerClient,
    chainId,
  });
  const live = new LiveExecutor({ router, signer, client });

  logger.warn(
    { wallet: info.address, maxNotionalWei: maxNotionalWei.toString() },
    "LIVE MODE — real signatures enabled, capped per trade",
  );

  return {
    executor: withNotionalCap(live, maxNotionalWei),
    positions: positions.store,
    strategyStore: strategies.store,
    walletId,
    simulated: false,
    cleanups,
  };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ name: "worker" });
  const mode = resolveMode();

  // --- Infra: same bus + RPC pool the gateway boots on ---
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  const bus = new RedisEventBus({ redis, logger });
  const rpcPool = new RpcPool({ endpoints: rpcEndpointsFromEnv(env), logger });
  const client = rpcPool.getClient();

  const chainId = SUPPORTED_CHAINS.base;
  const quoteAmount = bigintEnv("WORKER_SNIPE_QUOTE_WEI", 1_000_000_000_000_000n); // 0.001 WETH
  const maxSlippageBps = intEnv("WORKER_MAX_SLIPPAGE_BPS", 500);
  const tickMs = intEnv("WORKER_TICK_MS", 2_000);
  const scanPollMs = intEnv("WORKER_SCAN_POLL_MS", 1_500);
  const seedEnabled = (process.env.WORKER_SEED ?? "false").toLowerCase() === "true";

  // --- Execution path (paper vs live), resolved from the mode ---
  const adapters = createDexAdapters(client as ChainReader);
  const router = new AdapterRouter(adapters);
  const { executor, positions, strategyStore, walletId, simulated, cleanups } =
    await setupExecution({ mode, env, router, client, chainId, logger });

  // --- Rugpull Shield: fast pre-trade gate (honeypot, mint, ownership, taxes,
  // LP lock, ...). A "danger" verdict rejects the buy before it ever executes,
  // paper or live — see TradingEngine.trade(). Quick mode only: cheap detectors
  // under a tight timeout, cached per token, sized for a sniper's hot path.
  const shield = new ShieldAnalyzer({ client: client as ShieldClient, logger, chainId });

  const engine = new TradingEngine({
    executor,
    positions,
    logger,
    preTradeCheck: async (intent, pool) => {
      const risk = await shield.assessQuick({
        token: intent.token,
        quoteToken: counterToken(pool, intent.token),
        pool,
      });
      logger.info(
        { token: intent.token, score: risk.score, verdict: risk.verdict },
        "shield pre-trade verdict",
      );
      return risk;
    },
  });

  // --- Shared token → pool routing table ---
  const registry = new PoolRegistry();

  // --- Strategy layer ---
  const prices = new QuotePriceSource({ adapterFor: (rule) => router.adapterFor(rule.pool) });
  const strategyPositions: PositionSource = {
    async amountOf(cid, token, sim) {
      const record = await positions.get(cid, token, sim);
      return record?.amount ?? 0n;
    },
  };
  const runner = new StrategyRunner({
    bus,
    store: strategyStore,
    prices,
    positions: strategyPositions,
    logger,
    intervalMs: tickMs,
  });

  // --- Exit management: after every buy fill, arm a take-profit + stop-loss
  // (Task 1). Levels are generous by default — the entry price is buy-side, so
  // an immediate sell quote sits a round-trip spread below it (see exits.ts). ---
  const exitConfig: ExitConfig = {
    gainBps: intEnv("EXIT_TP_GAIN_BPS", 5_000), // +50%
    lossBps: intEnv("EXIT_SL_LOSS_BPS", 3_000), // −30%
    sellFractionBps: intEnv("EXIT_SELL_FRACTION_BPS", 10_000), // sell all
    maxSlippageBps: intEnv("EXIT_MAX_SLIPPAGE_BPS", maxSlippageBps),
  };

  // --- Scanner: watches Base DEX factories, emits token.detected / pool.created ---
  const scanState = new InMemoryScanState();
  const scanner = new Scanner({
    client,
    bus,
    cursors: scanState,
    seen: scanState,
    logger,
    pollIntervalMs: scanPollMs,
    maxBlockRange: intEnv("WORKER_SCAN_MAX_BLOCK_RANGE", 500),
  });

  // --- Wire the bus: detection → snipe rule, buy/sell.requested → engine,
  // trade.executed → exit rules ---
  const unsubs: Unsubscribe[] = [];
  unsubs.push(
    await attachSniper({
      bus,
      store: strategyStore,
      registry,
      quoteAmount,
      maxSlippageBps,
      walletId,
      simulated,
      logger,
    }),
  );
  unsubs.push(
    await attachEngine({
      bus,
      engine,
      logger,
      resolvePool: async (intent) => registry.poolFor(intent.token),
    }),
  );
  unsubs.push(
    await attachExitArmer({
      bus,
      store: strategyStore,
      registry,
      walletId,
      config: exitConfig,
      logger,
    }),
  );

  // --- Optional demo seed: arm a WETH/USDC snipe so a trade fires within
  // seconds, without waiting to catch a real launch. Off by default; opt in
  // with WORKER_SEED=true for local/demo runs only, never in a real deployment. ---
  if (seedEnabled) {
    try {
      const v3 = adapters.get("uniswap-v3");
      const pool = await v3?.getPool({ tokenA: BASE_USDC, tokenB: BASE_WETH, feeTier: 500 });
      if (pool !== undefined) {
        registry.record(BASE_USDC, pool);
        await strategyStore.upsert(
          buildSnipeRule({
            chainId,
            token: BASE_USDC,
            pool,
            quoteAmount,
            maxSlippageBps,
            at: Date.now(),
            walletId,
            simulated,
          }),
        );
        logger.info({ token: BASE_USDC, pool: pool.address }, "seeded demo snipe (WETH → USDC)");
      } else {
        logger.warn("demo seed skipped: WETH/USDC v3 pool not resolved");
      }
    } catch (error) {
      logger.warn({ err: error }, "demo seed failed; continuing with live scanner only");
    }
  }

  scanner.start();
  runner.start();
  logger.info(
    {
      mode,
      quoteAmount: quoteAmount.toString(),
      maxSlippageBps,
      tickMs,
      seedEnabled,
      exit: exitConfig,
    },
    "worker started — scanner + snipe strategy + TP/SL exits + engine",
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down worker");
    scanner.stop();
    runner.stop();
    for (const unsub of unsubs) {
      await unsub().catch(() => undefined);
    }
    for (const cleanup of cleanups) {
      await cleanup().catch(() => undefined);
    }
    await redis.quit().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  createLogger({ name: "worker" }).error({ err: error }, "worker failed to start");
  process.exit(1);
});
