/**
 * Dependency-injection tokens for every port the gateway consumes.
 *
 * This app never relies on `emitDecoratorMetadata` (see tsconfig.json): all
 * constructor dependencies are wired with `@Inject(<token>)`. Interfaces have
 * no runtime identity anyway, so explicit tokens are the honest contract —
 * and they are exactly what e2e tests override with in-memory fakes.
 */

/** The validated `Env` from `@bot/config`. */
export const ENV = Symbol("ENV");

/** `Logger` from `@bot/logger`. */
export const LOGGER = Symbol("LOGGER");

/** `EventBus` from `@bot/events` — Redis in production, in-memory in tests. */
export const EVENT_BUS = Symbol("EVENT_BUS");

/** `UserRepository` port. */
export const USER_REPOSITORY = Symbol("USER_REPOSITORY");

/** `ApiKeyRepository` port. */
export const API_KEY_REPOSITORY = Symbol("API_KEY_REPOSITORY");

/** `RateLimitStore` port — Redis in production, in-memory in tests. */
export const RATE_LIMIT_STORE = Symbol("RATE_LIMIT_STORE");

/** `QuoteFinder` port — DEX adapters over the RPC pool in production. */
export const QUOTE_FINDER = Symbol("QUOTE_FINDER");

/** `StatusProbe[]` — one health probe per infrastructure component. */
export const STATUS_PROBES = Symbol("STATUS_PROBES");

/** `() => number` clock (ms). Injected so rate-limit tests control time. */
export const CLOCK = Symbol("CLOCK");

/** `RpcPool` from `@bot/rpc-manager`. */
export const RPC_POOL = Symbol("RPC_POOL");

/** Shared ioredis client (rate limiting, probes, event-bus publishing). */
export const REDIS = Symbol("REDIS");

/** `DatabaseHandle` — drizzle instance + its pg pool. */
export const DATABASE = Symbol("DATABASE");
