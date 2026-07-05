import { SetMetadata, type CustomDecorator } from "@nestjs/common";
import type { Scope } from "../auth/scopes";

export const PUBLIC_KEY = "gateway:public";
export const SCOPES_KEY = "gateway:scopes";
export const RATE_BUCKET_KEY = "gateway:rate-bucket";
export const SKIP_RATE_LIMIT_KEY = "gateway:skip-rate-limit";

/** Route reachable without credentials (login, liveness). */
export const Public = (): CustomDecorator<string> => SetMetadata(PUBLIC_KEY, true);

/**
 * Scopes a route requires — the caller must hold ALL of them. Non-public
 * routes without a declaration are rejected by the ScopesGuard (fail closed),
 * so forgetting this decorator can't silently open an endpoint.
 */
export const RequireScopes = (...scopes: [Scope, ...Scope[]]): CustomDecorator<string> =>
  SetMetadata(SCOPES_KEY, scopes);

export type RateBucket = "default" | "login";

/** Pick a non-default rate-limit bucket (login is stricter, keyed by IP). */
export const RateLimitBucket = (bucket: RateBucket): CustomDecorator<string> =>
  SetMetadata(RATE_BUCKET_KEY, bucket);

/** Exempt a route from rate limiting (liveness probes hammer /health). */
export const SkipRateLimit = (): CustomDecorator<string> => SetMetadata(SKIP_RATE_LIMIT_KEY, true);
