import type { RpcEndpointConfig } from "./config";

export type EndpointStatus = "healthy" | "down";

/** Read-only snapshot of one endpoint's state, for logs, tests and dashboards. */
export interface EndpointHealth {
  url: string;
  status: EndpointStatus;
  weight: number;
  consecutiveFailures: number;
  /** Latency of the last successful health-check probe, if one has run. */
  latencyMs?: number;
  /** When a down endpoint becomes eligible for live traffic again (epoch ms). */
  retryAt?: number;
}

export interface ManagedEndpointOptions {
  config: RpcEndpointConfig;
  /** Consecutive failures before the endpoint is taken out of rotation. */
  failureThreshold: number;
  /** Initial cool-down once down; doubles on every failed probe. */
  cooldownMs: number;
  maxCooldownMs: number;
}

/**
 * Circuit-breaker state for a single RPC endpoint. Pure bookkeeping — the pool
 * owns the transports and the clock; this class never touches the network.
 */
export class ManagedEndpoint {
  readonly config: RpcEndpointConfig;

  /** Smooth weighted round-robin accumulator, managed by the pool's selector. */
  currentWeight = 0;
  /** Latency of the last successful health-check probe. */
  latencyMs: number | undefined;

  readonly #failureThreshold: number;
  readonly #baseCooldownMs: number;
  readonly #maxCooldownMs: number;

  #status: EndpointStatus = "healthy";
  #consecutiveFailures = 0;
  #cooldownMs: number;
  #retryAt = 0;

  constructor(options: ManagedEndpointOptions) {
    this.config = options.config;
    this.#failureThreshold = options.failureThreshold;
    this.#baseCooldownMs = options.cooldownMs;
    this.#maxCooldownMs = options.maxCooldownMs;
    this.#cooldownMs = options.cooldownMs;
  }

  get url(): string {
    return this.config.url;
  }

  get weight(): number {
    return this.config.weight;
  }

  get status(): EndpointStatus {
    return this.#status;
  }

  /**
   * Eligible for live traffic: healthy, or down but past its cool-down — the
   * half-open probe that lets a recovered node rejoin the rotation.
   */
  isSelectable(now: number): boolean {
    return this.#status === "healthy" || now >= this.#retryAt;
  }

  recordSuccess(): { recovered: boolean } {
    this.#consecutiveFailures = 0;
    this.#cooldownMs = this.#baseCooldownMs;
    if (this.#status === "down") {
      this.#status = "healthy";
      this.#retryAt = 0;
      return { recovered: true };
    }
    return { recovered: false };
  }

  recordFailure(now: number): { wentDown: boolean } {
    this.#consecutiveFailures += 1;
    if (this.#status === "down") {
      // A probe failed while down: back off harder before the next one.
      this.#cooldownMs = Math.min(this.#cooldownMs * 2, this.#maxCooldownMs);
      this.#retryAt = now + this.#cooldownMs;
      return { wentDown: false };
    }
    if (this.#consecutiveFailures >= this.#failureThreshold) {
      this.#status = "down";
      this.#retryAt = now + this.#cooldownMs;
      return { wentDown: true };
    }
    return { wentDown: false };
  }

  health(): EndpointHealth {
    return {
      url: this.url,
      status: this.#status,
      weight: this.weight,
      consecutiveFailures: this.#consecutiveFailures,
      ...(this.latencyMs !== undefined ? { latencyMs: this.latencyMs } : {}),
      ...(this.#status === "down" ? { retryAt: this.#retryAt } : {}),
    };
  }
}
