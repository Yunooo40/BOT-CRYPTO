import { randomUUID } from "node:crypto";
import { InfraError } from "@bot/errors";
import type { Redis } from "ioredis";
import type { RateLimitDecision, RateLimitStore } from "./store";

const KEY_PREFIX = "ratelimit:";

/**
 * Sliding-window log on a Redis sorted set (score = hit time). The whole
 * window is exact — no fixed-window burst at the boundary — and the state is
 * shared, so N gateway replicas enforce one budget.
 *
 * A denied hit removes its own member again: only served requests consume
 * budget (see {@link RateLimitStore.hit}).
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  async hit(
    key: string,
    limit: number,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitDecision> {
    const redisKey = `${KEY_PREFIX}${key}`;
    const member = `${nowMs}:${randomUUID()}`;
    const cutoff = nowMs - windowMs;

    try {
      const replies = await this.redis
        .multi()
        .zremrangebyscore(redisKey, 0, cutoff)
        .zadd(redisKey, nowMs, member)
        .zcard(redisKey)
        .zrange(redisKey, 0, 0, "WITHSCORES")
        .pexpire(redisKey, windowMs)
        .exec();
      if (replies === null) {
        throw new Error("MULTI aborted");
      }
      const count = Number(replies[2]?.[1] ?? 0);
      if (count <= limit) {
        return { allowed: true, remaining: limit - count, retryAfterMs: 0 };
      }
      // Over budget: give the slot back and compute when the oldest hit ages out.
      await this.redis.zrem(redisKey, member);
      const oldestReply = replies[3]?.[1] as string[] | undefined;
      const oldestScore = Number(oldestReply?.[1] ?? nowMs);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(oldestScore + windowMs - nowMs, 0),
      };
    } catch (error) {
      // Fail closed: a platform that trades real money must not lose its
      // brakes when Redis blips. The filter turns this into a retryable 503.
      throw new InfraError("rate-limit store unavailable", { cause: error });
    }
  }
}
