import type { EventBus } from "@bot/events";
import type { RpcPool } from "@bot/rpc-manager";
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import type { Redis } from "ioredis";
import type { DatabaseHandle } from "./db/client";
import { DATABASE, EVENT_BUS, REDIS, RPC_POOL } from "./tokens";

/**
 * Starts and drains the infrastructure the DI container owns. Shutdown is
 * defensive on purpose: closing one dependency must not strand the others,
 * and test fakes only implement what they need.
 */
@Injectable()
export class InfraLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(RPC_POOL) private readonly rpcPool: RpcPool,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DATABASE) private readonly database: DatabaseHandle,
  ) {}

  onApplicationBootstrap(): void {
    this.rpcPool.start?.();
  }

  async onApplicationShutdown(): Promise<void> {
    this.rpcPool.stop?.();
    await this.bus.close().catch(() => undefined);
    await this.redis.quit().catch(() => undefined);
    await this.database.pool?.end().catch(() => undefined);
  }
}
