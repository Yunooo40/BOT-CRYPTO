import "reflect-metadata";
import { loadEnv, type Env } from "@bot/config";
import { PoolNotFoundError } from "@bot/dex-adapters";
import { poolSchema, toAddress } from "@bot/domain";
import { InMemoryPositionStore, type PositionStore } from "@bot/engine-core";
import { InMemoryEventBus } from "@bot/events";
import { createLogger } from "@bot/logger";
import { RpcInfraError } from "@bot/rpc-manager";
import type { INestApplication } from "@nestjs/common";
import { WsAdapter } from "@nestjs/platform-ws";
import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module";
import { InMemoryApiKeyRepository, InMemoryUserRepository } from "../auth/in-memory";
import { InMemoryTradeHistoryRepository } from "../portfolio/in-memory";
import { InMemoryRateLimitStore } from "../rate-limit/in-memory-store";
import type { QuoteFinder } from "../quotes/quote-finder";
import {
  API_KEY_REPOSITORY,
  DATABASE,
  ENV,
  EVENT_BUS,
  LOGGER,
  PORTFOLIO_POSITIONS,
  QUOTE_FINDER,
  RATE_LIMIT_STORE,
  REDIS,
  RPC_POOL,
  STATUS_PROBES,
  TRADE_HISTORY_REPOSITORY,
  USER_REPOSITORY,
} from "../tokens";

export const ADMIN_EMAIL = "admin@test.dev";
export const ADMIN_PASSWORD = "admin-password-123";

/** Any pair involving this address makes the fake finder answer 404. */
export const DEAD_TOKEN = toAddress("0x000000000000000000000000000000000000dead");

/**
 * This one simulates every RPC endpoint being down, the way it reaches the
 * filter in production: the platform error buried under a third-party wrapper
 * (viem's ContractFunctionExecutionError does exactly this).
 */
export const DOWN_TOKEN = toAddress("0x000000000000000000000000000000000000d011");

/** The fake venue doubles your money. Real markets may vary. */
const fakeQuoteFinder: QuoteFinder = {
  async bestQuote(params) {
    if (params.tokenIn === DEAD_TOKEN || params.tokenOut === DEAD_TOKEN) {
      throw new PoolNotFoundError(`No pool for ${params.tokenIn}/${params.tokenOut}`);
    }
    if (params.tokenIn === DOWN_TOKEN || params.tokenOut === DOWN_TOKEN) {
      throw new Error("contract call failed", {
        cause: new RpcInfraError("no RPC endpoint available (all down and cooling off)"),
      });
    }
    const pool = poolSchema.parse({
      chainId: 8453,
      address: "0x00000000000000000000000000000000000000aa",
      dex: "uniswap-v2",
      token0: params.tokenIn,
      token1: params.tokenOut,
    });
    return {
      pool,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      amountOut: params.amountIn * 2n,
      priceImpactBps: 12,
    };
  },
};

export interface TestApp {
  app: INestApplication;
  bus: InMemoryEventBus;
  users: InMemoryUserRepository;
  apiKeys: InMemoryApiKeyRepository;
  tradeHistory: InMemoryTradeHistoryRepository;
  positions: PositionStore;
  env: Env;
}

/**
 * The full production module with every infra token swapped for an in-memory
 * fake — same controllers, same guards, same filter, no sockets to anywhere.
 */
export async function createTestApp(envOverrides: NodeJS.ProcessEnv = {}): Promise<TestApp> {
  const env = loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "fatal",
    DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
    REDIS_URL: "redis://localhost:6379",
    BASE_RPC_URLS: "https://unused.invalid",
    JWT_SECRET: "test-secret-test-secret-test-secret!",
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    ...envOverrides,
  });

  const bus = new InMemoryEventBus();
  const users = new InMemoryUserRepository();
  const apiKeys = new InMemoryApiKeyRepository();
  const tradeHistory = new InMemoryTradeHistoryRepository();
  const positions = new InMemoryPositionStore();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(LOGGER)
    .useValue(createLogger({ level: "fatal" }))
    .overrideProvider(RPC_POOL)
    .useValue({
      start: () => undefined,
      stop: () => undefined,
      health: () => [],
      getClient: () => {
        throw new Error("no RPC in e2e tests");
      },
    })
    .overrideProvider(DATABASE)
    .useValue({ pool: { end: async () => undefined } })
    .overrideProvider(REDIS)
    .useValue({ quit: async () => "OK" })
    .overrideProvider(EVENT_BUS)
    .useValue(bus)
    .overrideProvider(USER_REPOSITORY)
    .useValue(users)
    .overrideProvider(API_KEY_REPOSITORY)
    .useValue(apiKeys)
    .overrideProvider(TRADE_HISTORY_REPOSITORY)
    .useValue(tradeHistory)
    .overrideProvider(PORTFOLIO_POSITIONS)
    .useValue(positions)
    .overrideProvider(RATE_LIMIT_STORE)
    .useValue(new InMemoryRateLimitStore())
    .overrideProvider(QUOTE_FINDER)
    .useValue(fakeQuoteFinder)
    .overrideProvider(STATUS_PROBES)
    .useValue([{ name: "fake", probe: async () => ({ name: "fake", ok: true }) }])
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.init(); // runs AdminBootstrap: the admin user exists after this
  return { app, bus, users, apiKeys, tradeHistory, positions, env };
}
