import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { RedisRateLimitStore } from "./redis-store";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
// When REDIS_URL is set explicitly (CI), the integration suite must run — an
// unreachable Redis is a failure, not a silent skip.
const REDIS_REQUIRED = process.env.REDIS_URL !== undefined;

async function redisReachable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  probe.on("error", () => undefined);
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const available = await redisReachable();

it.runIf(REDIS_REQUIRED)("redis is reachable when REDIS_URL is set", () => {
  expect(available).toBe(true);
});

describe.runIf(available)("RedisRateLimitStore (integration)", () => {
  const redis = new Redis(REDIS_URL);
  const store = new RedisRateLimitStore(redis);
  const WINDOW = 60_000;

  afterAll(async () => {
    await redis.quit();
  });

  it("allows up to the limit, then denies with a retry hint", async () => {
    const key = `test:${randomUUID()}`;
    const t0 = Date.now();
    await expect(store.hit(key, 2, WINDOW, t0)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(store.hit(key, 2, WINDOW, t0 + 1)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    const denied = await store.hit(key, 2, WINDOW, t0 + 2);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(WINDOW);
  });

  it("denied hits do not consume budget", async () => {
    const key = `test:${randomUUID()}`;
    const t0 = Date.now();
    await store.hit(key, 1, WINDOW, t0);
    await store.hit(key, 1, WINDOW, t0 + 1);
    await store.hit(key, 1, WINDOW, t0 + 2);
    // Past the window of the single counted hit, the budget is whole again.
    await expect(store.hit(key, 1, WINDOW, t0 + WINDOW + 10)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("slides the window on real timestamps", async () => {
    const key = `test:${randomUUID()}`;
    const t0 = Date.now();
    await store.hit(key, 1, WINDOW, t0);
    await expect(store.hit(key, 1, WINDOW, t0 + WINDOW + 1)).resolves.toMatchObject({
      allowed: true,
    });
  });
});
