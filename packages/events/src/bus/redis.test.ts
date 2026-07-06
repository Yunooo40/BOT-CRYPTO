import { randomUUID } from "node:crypto";
import { toAddress } from "@bot/domain";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEvent } from "../catalog";
import { RedisEventBus } from "./redis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
// When REDIS_URL is set explicitly (CI), the integration suite must run — an
// unreachable Redis is a failure, not a silent skip.
const REDIS_REQUIRED = process.env.REDIS_URL !== undefined;
const TOKEN = toAddress("0x4200000000000000000000000000000000000006");

/** Probe Redis once; the whole suite is skipped when it's unreachable (e.g. no Docker locally). */
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

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const available = await redisReachable();

// Guard: in CI (REDIS_URL set) this asserts the suite below actually ran instead
// of being skipped, so a green pipeline genuinely proves the Redis bus works.
it.runIf(REDIS_REQUIRED)("Redis is reachable when REDIS_URL is configured (CI guard)", () => {
  expect(available).toBe(true);
});

describe.skipIf(!available)("RedisEventBus (integration)", () => {
  const prefix = `test:${randomUUID()}:`;
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    redis.on("error", () => undefined);
  });

  afterAll(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await redis.quit();
  });

  it("delivers a published event to a consumer group and acknowledges it", async () => {
    const bus = new RedisEventBus({ redis, keyPrefix: prefix, blockMs: 200 });
    const received: string[] = [];

    const unsubscribe = await bus.subscribe(
      "token.detected",
      (event) => {
        received.push(event.payload.token.symbol);
      },
      { group: "svc-test" },
    );

    await bus.publish(
      createEvent(
        "token.detected",
        {
          token: {
            chainId: 8453,
            address: TOKEN,
            symbol: "WETH",
            name: "Wrapped Ether",
            decimals: 18,
          },
        },
        { source: "scanner" },
      ),
    );

    await waitFor(() => received.length === 1, 3000);
    expect(received).toEqual(["WETH"]);

    // After a successful handler the message is acked → no pending entries remain.
    const pending = (await redis.xpending(`${prefix}token.detected`, "svc-test")) as unknown[];
    expect(pending[0]).toBe(0);

    await unsubscribe();
    await bus.close();
  });

  it("acks and drops an unparseable (poison) message instead of retrying it forever", async () => {
    const key = `${prefix}pool.created`;
    const bus = new RedisEventBus({ redis, keyPrefix: prefix, blockMs: 200 });
    const received: string[] = [];

    const unsubscribe = await bus.subscribe(
      "pool.created",
      (event) => {
        received.push(event.payload.pool.address);
      },
      { group: "svc-poison" },
    );

    // Inject a message the schema can never parse, straight onto the stream.
    await redis.xadd(key, "*", "data", "{not valid json");

    // A well-formed event published afterwards must still be delivered — proof the
    // poison pill was acked and dropped rather than wedging the consumer.
    await bus.publish(
      createEvent(
        "pool.created",
        {
          pool: {
            chainId: 8453,
            address: TOKEN,
            dex: "aerodrome",
            token0: TOKEN,
            token1: TOKEN,
          },
        },
        { source: "scanner" },
      ),
    );

    await waitFor(() => received.length === 1, 3000);
    expect(received).toEqual([TOKEN]);

    // Nothing left pending: the poison message was acked, not parked.
    const pending = (await redis.xpending(key, "svc-poison")) as unknown[];
    expect(pending[0]).toBe(0);

    await unsubscribe();
    await bus.close();
  });
});
