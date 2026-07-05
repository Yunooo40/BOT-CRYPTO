import type { RateLimitDecision, RateLimitStore } from "./store";

/** Exact sliding-window log in process memory. */
export class InMemoryRateLimitStore implements RateLimitStore {
  readonly #hits = new Map<string, number[]>();

  async hit(
    key: string,
    limit: number,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitDecision> {
    const cutoff = nowMs - windowMs;
    const alive = (this.#hits.get(key) ?? []).filter((at) => at > cutoff);

    if (alive.length >= limit) {
      this.#hits.set(key, alive);
      const oldest = alive[0] ?? nowMs;
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(oldest + windowMs - nowMs, 0) };
    }

    alive.push(nowMs);
    this.#hits.set(key, alive);
    return { allowed: true, remaining: limit - alive.length, retryAfterMs: 0 };
  }
}
