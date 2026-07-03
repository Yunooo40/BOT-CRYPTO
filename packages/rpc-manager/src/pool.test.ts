import { InfraError, ValidationError } from "@bot/errors";
import { createLogger } from "@bot/logger";
import { RpcRequestError } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcInfraError } from "./errors";
import {
  RpcPool,
  type RpcPoolOptions,
  type RpcRequestArgs,
  type RpcTransportFactory,
} from "./pool";

const silent = createLogger({ destination: { write: () => {} } });

const A = "https://a.example";
const B = "https://b.example";
const C = "https://c.example";

type Impl = (args: RpcRequestArgs) => Promise<unknown>;

const ok =
  (result: unknown = "0x10"): Impl =>
  () =>
    Promise.resolve(result);

const netFail =
  (message = "ECONNREFUSED"): Impl =>
  () =>
    Promise.reject(new Error(message));

/** A pool over fake transports: per-URL behaviour, call counts, fake clock. */
function harness(
  endpoints: Array<{ url: string; weight?: number; impl: Impl }>,
  overrides: Partial<RpcPoolOptions> = {},
) {
  const impls = new Map<string, Impl>(endpoints.map((endpoint) => [endpoint.url, endpoint.impl]));
  const calls = new Map<string, number>();
  const transportFactory: RpcTransportFactory = (config) => ({
    request: (args) => {
      calls.set(config.url, (calls.get(config.url) ?? 0) + 1);
      const impl = impls.get(config.url);
      return impl === undefined
        ? Promise.reject(new Error(`no impl for ${config.url}`))
        : impl(args);
    },
  });
  const clock = { t: 0 };
  const pool = new RpcPool({
    endpoints: endpoints.map(({ url, weight = 1 }) => ({ url, weight })),
    logger: silent,
    transportFactory,
    now: () => clock.t,
    ...overrides,
  });
  return {
    pool,
    clock,
    impls,
    callsTo: (url: string) => calls.get(url) ?? 0,
    healthOf: (url: string) => pool.health().find((health) => health.url === url),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RpcPool", () => {
  it("rejects an empty endpoint list at construction", () => {
    expect(() => new RpcPool({ endpoints: [], logger: silent })).toThrow(ValidationError);
  });

  it("serves a request through the selected endpoint", async () => {
    const { pool, callsTo } = harness([{ url: A, impl: ok() }]);
    await expect(pool.request({ method: "eth_blockNumber" })).resolves.toBe("0x10");
    expect(callsTo(A)).toBe(1);
  });

  it("distributes traffic proportionally to weights", async () => {
    const { pool, callsTo } = harness([
      { url: A, weight: 2, impl: ok() },
      { url: B, weight: 1, impl: ok() },
    ]);
    for (let i = 0; i < 6; i += 1) {
      await pool.request({ method: "eth_blockNumber" });
    }
    expect(callsTo(A)).toBe(4);
    expect(callsTo(B)).toBe(2);
  });

  it("fails over to the next endpoint on an infrastructure error", async () => {
    const { pool, callsTo, healthOf } = harness([
      { url: A, impl: netFail() },
      { url: B, impl: ok() },
    ]);
    await expect(pool.request({ method: "eth_blockNumber" })).resolves.toBe("0x10");
    expect(callsTo(A)).toBe(1);
    expect(callsTo(B)).toBe(1);
    expect(healthOf(A)).toMatchObject({ status: "healthy", consecutiveFailures: 1 });
  });

  it("fails over on a node-fault JSON-RPC error (rate limit)", async () => {
    const limited = new RpcRequestError({
      body: {},
      error: { code: -32005, message: "limit exceeded" },
      url: A,
    });
    const { pool } = harness([
      { url: A, impl: () => Promise.reject(limited) },
      { url: B, impl: ok() },
    ]);
    await expect(pool.request({ method: "eth_blockNumber" })).resolves.toBe("0x10");
  });

  it("surfaces application-level JSON-RPC errors verbatim, without failover", async () => {
    const revert = new RpcRequestError({
      body: {},
      error: { code: 3, message: "execution reverted" },
      url: A,
    });
    const { pool, callsTo, healthOf } = harness([
      { url: A, impl: () => Promise.reject(revert) },
      { url: B, impl: ok() },
    ]);
    await expect(pool.request({ method: "eth_call" })).rejects.toBe(revert);
    expect(callsTo(B)).toBe(0);
    // The node answered: it is alive, and its failure counter is reset.
    expect(healthOf(A)).toMatchObject({ status: "healthy", consecutiveFailures: 0 });
  });

  it("takes a repeatedly failing endpoint out of rotation, then lets it back in", async () => {
    const { pool, clock, impls, callsTo, healthOf } = harness(
      [
        { url: A, weight: 100, impl: netFail() },
        { url: B, weight: 1, impl: ok() },
      ],
      { failureThreshold: 2 },
    );

    // Two failed requests trip A's breaker; both still succeed via B.
    await pool.request({ method: "eth_blockNumber" });
    await pool.request({ method: "eth_blockNumber" });
    expect(healthOf(A)?.status).toBe("down");
    expect(callsTo(A)).toBe(2);

    // While cooling off, A is not even tried.
    await pool.request({ method: "eth_blockNumber" });
    expect(callsTo(A)).toBe(2);

    // Past the cool-down the half-open probe hits A again; it recovered.
    clock.t = 10_001;
    impls.set(A, ok());
    await expect(pool.request({ method: "eth_blockNumber" })).resolves.toBe("0x10");
    expect(callsTo(A)).toBe(3);
    expect(healthOf(A)).toMatchObject({ status: "healthy", consecutiveFailures: 0 });
  });

  it("throws a retryable RpcInfraError when every endpoint fails", async () => {
    const { pool } = harness([
      { url: A, impl: netFail() },
      { url: B, impl: netFail("socket hang up") },
    ]);
    const error: unknown = await pool.request({ method: "eth_blockNumber" }).catch((e) => e);
    expect(error).toBeInstanceOf(RpcInfraError);
    expect(error).toBeInstanceOf(InfraError);
    expect((error as RpcInfraError).context?.["attempted"]).toEqual([A, B]);
    expect((error as RpcInfraError).cause).toBeInstanceOf(Error);
  });

  it("fails fast when every endpoint is down and cooling off", async () => {
    const { pool, callsTo } = harness(
      [
        { url: A, impl: netFail() },
        { url: B, impl: netFail() },
      ],
      { failureThreshold: 1 },
    );
    await expect(pool.request({ method: "eth_blockNumber" })).rejects.toThrow(RpcInfraError);
    expect(callsTo(A) + callsTo(B)).toBe(2);
    // Both breakers are open: no transport is touched anymore.
    await expect(pool.request({ method: "eth_blockNumber" })).rejects.toThrow(
      /no RPC endpoint available/,
    );
    expect(callsTo(A) + callsTo(B)).toBe(2);
  });

  it("caps failover at maxAttemptsPerRequest distinct endpoints", async () => {
    const { pool, callsTo } = harness(
      [
        { url: A, impl: netFail() },
        { url: B, impl: netFail() },
        { url: C, impl: netFail() },
      ],
      { maxAttemptsPerRequest: 2 },
    );
    await expect(pool.request({ method: "eth_blockNumber" })).rejects.toThrow(RpcInfraError);
    expect(callsTo(A) + callsTo(B) + callsTo(C)).toBe(2);
  });

  it("checkNow probes every endpoint, records latency and recovers down nodes", async () => {
    const { pool, impls, healthOf } = harness(
      [
        { url: A, impl: ok() },
        { url: B, impl: netFail() },
      ],
      { failureThreshold: 1 },
    );
    await pool.checkNow();
    expect(healthOf(A)).toMatchObject({ status: "healthy", latencyMs: 0 });
    expect(healthOf(B)?.status).toBe("down");

    // A health check probes down endpoints too — no need to wait out the
    // cool-down for a node that is back.
    impls.set(B, ok());
    await pool.checkNow();
    expect(healthOf(B)).toMatchObject({ status: "healthy", consecutiveFailures: 0 });
  });

  it("start()/stop() drive periodic health checks", async () => {
    vi.useFakeTimers();
    const { pool, callsTo } = harness([{ url: A, impl: ok() }], {
      healthCheckIntervalMs: 1_000,
    });
    pool.start();
    pool.start(); // idempotent: no second timer
    await vi.advanceTimersByTimeAsync(3_000);
    expect(callsTo(A)).toBe(3);
    pool.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(callsTo(A)).toBe(3);
  });

  it("getClient() returns a memoized viem client backed by the pool", async () => {
    const { pool } = harness([{ url: A, impl: ok("0x10") }]);
    const client = pool.getClient();
    expect(pool.getClient()).toBe(client);
    await expect(client.getBlockNumber()).resolves.toBe(16n);
  });

  it("keeps the RpcInfraError on the cause chain of viem client rejections", async () => {
    const { pool } = harness([{ url: A, impl: netFail() }]);
    const error: unknown = await pool
      .getClient()
      .getBlockNumber()
      .catch((e: unknown) => e);
    // viem wraps non-viem errors (UnknownRpcError); our classification must
    // remain reachable by walking the cause chain.
    let found = false;
    for (let cursor = error; cursor instanceof Error; cursor = cursor.cause) {
      if (cursor instanceof RpcInfraError) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});
