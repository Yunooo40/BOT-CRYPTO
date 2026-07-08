import { loadEnv } from "@bot/config";
import {
  BASE_USDC,
  BASE_WETH,
  counterToken,
  createDexAdapters,
  type ChainReader,
} from "@bot/dex-adapters";
import { SUPPORTED_CHAINS } from "@bot/domain";
import {
  AdapterRouter,
  attachEngine,
  InMemoryPositionStore,
  PaperExecutor,
  TradingEngine,
} from "@bot/engine-core";
import { RedisEventBus, type Unsubscribe } from "@bot/events";
import { createLogger } from "@bot/logger";
import { rpcEndpointsFromEnv, RpcPool } from "@bot/rpc-manager";
import { InMemoryScanState, Scanner } from "@bot/scanner-core";
import { ShieldAnalyzer, type ShieldClient } from "@bot/shield-core";
import {
  InMemoryStrategyStore,
  QuotePriceSource,
  StrategyRunner,
  type PositionSource,
} from "@bot/strategies-core";
import { Redis } from "ioredis";
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

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ name: "worker" });

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

  // --- Engine (paper): quote-only, no key, no chain writes ---
  const adapters = createDexAdapters(client as ChainReader);
  const router = new AdapterRouter(adapters);
  const positions = new InMemoryPositionStore();

  // --- Rugpull Shield: fast pre-trade gate (honeypot, mint, ownership, taxes,
  // LP lock, ...). A "danger" verdict rejects the buy before it ever executes,
  // paper or live — see TradingEngine.trade(). Quick mode only: cheap detectors
  // under a tight timeout, cached per token, sized for a sniper's hot path.
  const shield = new ShieldAnalyzer({ client: client as ShieldClient, logger, chainId });

  const engine = new TradingEngine({
    executor: new PaperExecutor({ router }),
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
  const store = new InMemoryStrategyStore();
  const prices = new QuotePriceSource({ adapterFor: (rule) => router.adapterFor(rule.pool) });
  const strategyPositions: PositionSource = {
    async amountOf(cid, token, simulated) {
      const record = await positions.get(cid, token, simulated);
      return record?.amount ?? 0n;
    },
  };
  const runner = new StrategyRunner({
    bus,
    store,
    prices,
    positions: strategyPositions,
    logger,
    intervalMs: tickMs,
  });

  // --- Scanner: watches Base DEX factories, emits token.detected / pool.created ---
  const scanState = new InMemoryScanState();
  const scanner = new Scanner({
    client,
    bus,
    cursors: scanState,
    seen: scanState,
    logger,
    pollIntervalMs: scanPollMs,
  });

  // --- Wire the bus: detection → snipe rule, and buy/sell.requested → engine ---
  const unsubs: Unsubscribe[] = [];
  unsubs.push(await attachSniper({ bus, store, registry, quoteAmount, maxSlippageBps, logger }));
  unsubs.push(
    await attachEngine({
      bus,
      engine,
      logger,
      resolvePool: async (intent) => registry.poolFor(intent.token),
    }),
  );

  // --- Optional demo seed: arm a WETH/USDC snipe so a paper trade fires within
  // seconds, without waiting to catch a real launch. Off by default; opt in
  // with WORKER_SEED=true for local/demo runs only, never in a real deployment.
  if (seedEnabled) {
    try {
      const v3 = adapters.get("uniswap-v3");
      const pool = await v3?.getPool({ tokenA: BASE_USDC, tokenB: BASE_WETH, feeTier: 500 });
      if (pool !== undefined) {
        registry.record(BASE_USDC, pool);
        await store.upsert(
          buildSnipeRule({
            chainId,
            token: BASE_USDC,
            pool,
            quoteAmount,
            maxSlippageBps,
            at: Date.now(),
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
    { quoteAmount: quoteAmount.toString(), maxSlippageBps, tickMs, seedEnabled },
    "worker started — scanner + snipe strategy + paper engine",
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down worker");
    scanner.stop();
    runner.stop();
    for (const unsub of unsubs) {
      await unsub().catch(() => undefined);
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
