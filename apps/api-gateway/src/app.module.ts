import { loadEnv, type Env } from "@bot/config";
import { createDexAdapters } from "@bot/dex-adapters";
import { RedisEventBus } from "@bot/events";
import { createLogger, type Logger } from "@bot/logger";
import { rpcEndpointsFromEnv, RpcPool } from "@bot/rpc-manager";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { Redis } from "ioredis";
import { AdminBootstrap } from "./auth/admin-bootstrap";
import { ApiKeysController } from "./auth/api-keys.controller";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { AuthService } from "./auth/auth.service";
import { JwtService } from "./auth/jwt.service";
import { ScopesGuard } from "./auth/scopes.guard";
import { GatewayExceptionFilter } from "./common/exception.filter";
import { createDatabase, type DatabaseHandle } from "./db/client";
import { PostgresApiKeyRepository, PostgresUserRepository } from "./db/postgres-repositories";
import { InfraLifecycle } from "./infra-lifecycle";
import { DexQuoteFinder } from "./quotes/quote-finder";
import { QuotesController } from "./quotes/quotes.controller";
import { RateLimitGuard } from "./rate-limit/rate-limit.guard";
import { RedisRateLimitStore } from "./rate-limit/redis-store";
import { postgresProbe, redisProbe, rpcProbe } from "./status/probes";
import { HealthController, StatusController } from "./status/status.controller";
import {
  API_KEY_REPOSITORY,
  CLOCK,
  DATABASE,
  ENV,
  EVENT_BUS,
  LOGGER,
  QUOTE_FINDER,
  RATE_LIMIT_STORE,
  REDIS,
  RPC_POOL,
  STATUS_PROBES,
  USER_REPOSITORY,
} from "./tokens";
import { EventsGateway } from "./ws/events.gateway";

/**
 * Everything real lives behind a token (see tokens.ts); e2e tests override
 * exactly these providers with in-memory fakes and exercise the same
 * controllers, guards and filters as production.
 *
 * Guard order is registration order: authenticate → authorize → rate-limit.
 */
@Module({
  controllers: [
    HealthController,
    StatusController,
    AuthController,
    ApiKeysController,
    QuotesController,
  ],
  providers: [
    { provide: ENV, useFactory: (): Env => loadEnv() },
    {
      provide: LOGGER,
      useFactory: (env: Env): Logger => createLogger({ level: env.LOG_LEVEL, name: "api-gateway" }),
      inject: [ENV],
    },
    { provide: CLOCK, useValue: (): number => Date.now() },
    {
      provide: RPC_POOL,
      useFactory: (env: Env, logger: Logger): RpcPool =>
        new RpcPool({ endpoints: rpcEndpointsFromEnv(env), logger }),
      inject: [ENV, LOGGER],
    },
    {
      provide: DATABASE,
      useFactory: (env: Env): DatabaseHandle => createDatabase(env.DATABASE_URL),
      inject: [ENV],
    },
    {
      provide: REDIS,
      useFactory: (env: Env): Redis => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 }),
      inject: [ENV],
    },
    {
      provide: EVENT_BUS,
      useFactory: (redis: Redis, logger: Logger): RedisEventBus =>
        new RedisEventBus({ redis, logger }),
      inject: [REDIS, LOGGER],
    },
    {
      provide: USER_REPOSITORY,
      useFactory: (handle: DatabaseHandle): PostgresUserRepository =>
        new PostgresUserRepository(handle.db),
      inject: [DATABASE],
    },
    {
      provide: API_KEY_REPOSITORY,
      useFactory: (handle: DatabaseHandle): PostgresApiKeyRepository =>
        new PostgresApiKeyRepository(handle.db),
      inject: [DATABASE],
    },
    {
      provide: RATE_LIMIT_STORE,
      useFactory: (redis: Redis): RedisRateLimitStore => new RedisRateLimitStore(redis),
      inject: [REDIS],
    },
    {
      provide: QUOTE_FINDER,
      useFactory: (pool: RpcPool): DexQuoteFinder =>
        new DexQuoteFinder(createDexAdapters(pool.getClient())),
      inject: [RPC_POOL],
    },
    {
      provide: STATUS_PROBES,
      useFactory: (pool: RpcPool, database: DatabaseHandle, redis: Redis) => [
        rpcProbe(pool),
        postgresProbe(database),
        redisProbe(redis),
      ],
      inject: [RPC_POOL, DATABASE, REDIS],
    },
    JwtService,
    AuthService,
    AdminBootstrap,
    EventsGateway,
    InfraLifecycle,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ScopesGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_FILTER, useClass: GatewayExceptionFilter },
  ],
})
export class AppModule {}
