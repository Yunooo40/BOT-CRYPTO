import { createLogger, type Logger } from "@bot/logger";
import { ValidationError } from "@bot/errors";
import { createPublicClient, custom, http, type Chain, type PublicClient } from "viem";
import { base } from "viem/chains";
import { isEndpointFailure } from "./classify";
import type { RpcEndpointConfig } from "./config";
import { ManagedEndpoint, type EndpointHealth } from "./endpoint";
import { RpcInfraError } from "./errors";

/** A JSON-RPC request as seen at the transport boundary. */
export interface RpcRequestArgs {
  method: string;
  params?: unknown;
}

/** Minimal transport contract — what the pool needs from one endpoint. */
export interface RpcTransport {
  request(args: RpcRequestArgs): Promise<unknown>;
}

/**
 * Builds the transport for one endpoint. The default wraps viem's `http`;
 * tests inject fakes here so no test ever touches the network.
 */
export type RpcTransportFactory = (
  endpoint: RpcEndpointConfig,
  options: { timeoutMs: number },
) => RpcTransport;

const defaultTransportFactory: RpcTransportFactory = (endpoint, { timeoutMs }) => {
  // retryCount: 0 — failover across endpoints is the pool's job; letting the
  // transport retry the same node underneath would multiply every attempt.
  const transport = http(endpoint.url, { retryCount: 0, timeout: timeoutMs })({});
  return { request: (args) => transport.request(args) };
};

export interface RpcPoolOptions {
  /** Endpoints of the pool, e.g. from `rpcEndpointsFromEnv(env)`. */
  endpoints: RpcEndpointConfig[];
  /** viem chain the virtual client is bound to. Defaults to Base. */
  chain?: Chain;
  logger?: Logger;
  /** Distinct endpoints tried per request before giving up. Default 3. */
  maxAttemptsPerRequest?: number;
  /** Consecutive failures before an endpoint leaves the rotation. Default 3. */
  failureThreshold?: number;
  /** Per-request transport timeout. Default 5 000 ms. */
  requestTimeoutMs?: number;
  /** Background health-check period once `start()` is called. Default 30 000 ms. */
  healthCheckIntervalMs?: number;
  /** Initial cool-down for a down endpoint; doubles per failed probe. Default 10 000 ms. */
  cooldownMs?: number;
  /** Cool-down ceiling. Default 120 000 ms. */
  maxCooldownMs?: number;
  /** Test seam: fake transports. */
  transportFactory?: RpcTransportFactory;
  /** Test seam: clock. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * A pool of RPC endpoints behind a single viem `PublicClient`.
 *
 * `getClient()` returns a virtual client: every JSON-RPC request it makes is
 * routed to the best available endpoint (smooth weighted round-robin), fails
 * over to the next one on infrastructure errors, and trips a per-endpoint
 * circuit breaker after repeated failures. Down endpoints re-enter rotation
 * after an exponential cool-down or when a background health check succeeds.
 *
 * Constructing a pool performs no I/O; the network is only touched by requests
 * on the client and by health checks after `start()`.
 */
export class RpcPool {
  readonly #endpoints: ManagedEndpoint[];
  readonly #transports: Map<ManagedEndpoint, RpcTransport>;
  readonly #chain: Chain;
  readonly #logger: Logger;
  readonly #maxAttemptsPerRequest: number;
  readonly #healthCheckIntervalMs: number;
  readonly #now: () => number;

  #client: PublicClient | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: RpcPoolOptions) {
    if (options.endpoints.length === 0) {
      throw new ValidationError("RpcPool requires at least one endpoint");
    }
    const {
      chain = base,
      logger = createLogger({ name: "rpc-pool" }),
      maxAttemptsPerRequest = 3,
      failureThreshold = 3,
      requestTimeoutMs = 5_000,
      healthCheckIntervalMs = 30_000,
      cooldownMs = 10_000,
      maxCooldownMs = 120_000,
      transportFactory = defaultTransportFactory,
      now = Date.now,
    } = options;

    this.#chain = chain;
    this.#logger = logger;
    this.#maxAttemptsPerRequest = maxAttemptsPerRequest;
    this.#healthCheckIntervalMs = healthCheckIntervalMs;
    this.#now = now;

    this.#endpoints = options.endpoints.map(
      (config) => new ManagedEndpoint({ config, failureThreshold, cooldownMs, maxCooldownMs }),
    );
    this.#transports = new Map(
      this.#endpoints.map((endpoint) => [
        endpoint,
        transportFactory(endpoint.config, { timeoutMs: requestTimeoutMs }),
      ]),
    );
  }

  /**
   * The pool's virtual `PublicClient` (memoized). Safe to hand to any consumer:
   * load-balancing, failover and circuit breaking happen underneath every call.
   */
  getClient(): PublicClient {
    this.#client ??= createPublicClient({
      chain: this.#chain,
      transport: custom(
        { request: (args: RpcRequestArgs) => this.#dispatch(args) },
        // The pool already fails over; viem retrying on top would cube it.
        { retryCount: 0 },
      ),
    });
    return this.#client;
  }

  /**
   * Raw JSON-RPC escape hatch with the pool's failover semantics and direct
   * error classification: rejects with `RpcInfraError` when every endpoint is
   * down or failed. Prefer `getClient()` for typed calls — note that the viem
   * client wraps non-viem errors, so there the `RpcInfraError` sits on the
   * rejection's `cause` chain instead.
   */
  request<T = unknown>(args: RpcRequestArgs): Promise<T> {
    return this.#dispatch(args) as Promise<T>;
  }

  /** Current state of every endpoint, in configuration order. */
  health(): EndpointHealth[] {
    return this.#endpoints.map((endpoint) => endpoint.health());
  }

  /** Start periodic background health checks (idempotent). */
  start(): void {
    if (this.#timer !== undefined) {
      return;
    }
    this.#timer = setInterval(() => {
      void this.checkNow();
    }, this.#healthCheckIntervalMs);
    // Never keep the process alive just to poll RPC nodes.
    this.#timer.unref?.();
  }

  /** Stop background health checks (idempotent). */
  stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  /**
   * Probe every endpoint once (`eth_blockNumber`), including down ones — this
   * is how a dead node rejoins the rotation without waiting for its cool-down.
   * Records latency on success. Never throws.
   */
  async checkNow(): Promise<void> {
    await Promise.all(
      this.#endpoints.map(async (endpoint) => {
        const transport = this.#transports.get(endpoint);
        if (transport === undefined) {
          return;
        }
        const startedAt = this.#now();
        try {
          await transport.request({ method: "eth_blockNumber" });
          endpoint.latencyMs = this.#now() - startedAt;
          this.#applySuccess(endpoint);
        } catch (error) {
          this.#applyFailure(endpoint, error);
        }
      }),
    );
  }

  async #dispatch(args: RpcRequestArgs): Promise<unknown> {
    const tried = new Set<ManagedEndpoint>();
    const maxAttempts = Math.min(this.#maxAttemptsPerRequest, this.#endpoints.length);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const endpoint = this.#select(tried);
      if (endpoint === undefined) {
        break;
      }
      tried.add(endpoint);
      const transport = this.#transports.get(endpoint);
      if (transport === undefined) {
        continue;
      }
      try {
        const result = await transport.request(args);
        this.#applySuccess(endpoint);
        return result;
      } catch (error) {
        if (!isEndpointFailure(error)) {
          // The node answered with an application-level error: it is healthy,
          // and the error belongs to the caller, verbatim.
          this.#applySuccess(endpoint);
          throw error;
        }
        this.#applyFailure(endpoint, error);
        lastError = error;
        this.#logger.warn(
          { url: endpoint.url, method: args.method, attempt },
          "rpc request failed, failing over",
        );
      }
    }

    throw new RpcInfraError(
      tried.size === 0
        ? "no RPC endpoint available (all down and cooling off)"
        : `RPC request failed on all ${tried.size} attempted endpoint(s)`,
      {
        ...(lastError !== undefined ? { cause: lastError } : {}),
        context: {
          method: args.method,
          attempted: [...tried].map((endpoint) => endpoint.url),
          chainId: this.#chain.id,
        },
      },
    );
  }

  /**
   * Smooth weighted round-robin (nginx's algorithm) over the endpoints that
   * are selectable now and not yet tried for this request: deterministic,
   * starvation-free, and a weight-2 node gets exactly twice the traffic.
   */
  #select(exclude: ReadonlySet<ManagedEndpoint>): ManagedEndpoint | undefined {
    const now = this.#now();
    const candidates = this.#endpoints.filter(
      (endpoint) => !exclude.has(endpoint) && endpoint.isSelectable(now),
    );
    let best: ManagedEndpoint | undefined;
    let totalWeight = 0;
    for (const endpoint of candidates) {
      endpoint.currentWeight += endpoint.weight;
      totalWeight += endpoint.weight;
      if (best === undefined || endpoint.currentWeight > best.currentWeight) {
        best = endpoint;
      }
    }
    if (best !== undefined) {
      best.currentWeight -= totalWeight;
    }
    return best;
  }

  #applySuccess(endpoint: ManagedEndpoint): void {
    const { recovered } = endpoint.recordSuccess();
    if (recovered) {
      this.#logger.info({ url: endpoint.url }, "rpc endpoint recovered");
    }
  }

  #applyFailure(endpoint: ManagedEndpoint, error: unknown): void {
    const { wentDown } = endpoint.recordFailure(this.#now());
    if (wentDown) {
      this.#logger.error({ url: endpoint.url, err: error }, "rpc endpoint marked down");
    }
  }
}
