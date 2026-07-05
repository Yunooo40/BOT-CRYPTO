/**
 * Sliding-window rate limiting behind a port: Redis in production (shared
 * across gateway instances), in-memory in tests and single-node setups.
 */
export interface RateLimitDecision {
  allowed: boolean;
  /** Requests left in the window after this hit (0 when denied). */
  remaining: number;
  /** How long until a retry can succeed; 0 when allowed. */
  retryAfterMs: number;
}

export interface RateLimitStore {
  /**
   * Record a hit against `key` and decide. A denied hit must NOT consume
   * budget — hammering a 429 shouldn't push recovery further away.
   */
  hit(key: string, limit: number, windowMs: number, nowMs: number): Promise<RateLimitDecision>;
}
