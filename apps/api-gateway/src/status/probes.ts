import type { RpcPool } from "@bot/rpc-manager";
import type { Redis } from "ioredis";
import type { DatabaseHandle } from "../db/client";

export interface ComponentStatus {
  name: string;
  ok: boolean;
  detail?: Record<string, unknown>;
}

/** One infrastructure component the /v1/status endpoint reports on. */
export interface StatusProbe {
  name: string;
  probe(): Promise<ComponentStatus>;
}

/** Hostname only — RPC URLs routinely embed provider API keys in the path. */
function redactUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

export function rpcProbe(pool: Pick<RpcPool, "health">): StatusProbe {
  return {
    name: "rpc",
    async probe() {
      const endpoints = pool.health();
      const healthy = endpoints.filter((endpoint) => endpoint.status === "healthy").length;
      return {
        name: "rpc",
        ok: healthy > 0,
        detail: {
          healthy,
          total: endpoints.length,
          endpoints: endpoints.map((endpoint) => ({
            host: redactUrl(endpoint.url),
            status: endpoint.status,
            ...(endpoint.latencyMs !== undefined ? { latencyMs: endpoint.latencyMs } : {}),
          })),
        },
      };
    },
  };
}

export function redisProbe(redis: Pick<Redis, "ping">): StatusProbe {
  return {
    name: "redis",
    async probe() {
      const startedAt = Date.now();
      await redis.ping();
      return { name: "redis", ok: true, detail: { latencyMs: Date.now() - startedAt } };
    },
  };
}

export function postgresProbe(handle: Pick<DatabaseHandle, "pool">): StatusProbe {
  return {
    name: "postgres",
    async probe() {
      const startedAt = Date.now();
      await handle.pool.query("SELECT 1");
      return { name: "postgres", ok: true, detail: { latencyMs: Date.now() - startedAt } };
    },
  };
}
