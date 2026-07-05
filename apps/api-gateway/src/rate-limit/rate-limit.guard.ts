import type { Env } from "@bot/config";
import {
  HttpException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Response } from "express";
import { RATE_BUCKET_KEY, SKIP_RATE_LIMIT_KEY, type RateBucket } from "../common/decorators";
import { clientIp, type GatewayRequest } from "../common/http";
import { CLOCK, ENV, RATE_LIMIT_STORE } from "../tokens";
import type { RateLimitStore } from "./store";

const WINDOW_MS = 60_000;

/**
 * Third global guard (after auth + scopes): sliding-window budgets.
 *
 * - `default` bucket: one budget per authenticated identity — the API key if
 *   there is one, else the user — falling back to the client IP on public
 *   routes. RATE_LIMIT_PER_MINUTE requests/min.
 * - `login` bucket (POST /v1/auth/login): keyed by IP no matter what, with the
 *   stricter RATE_LIMIT_LOGIN_PER_MINUTE, so password guessing starves fast.
 *
 * Denials answer 429 with `Retry-After`; every response carries the
 * X-RateLimit-Limit / X-RateLimit-Remaining pair.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    @Inject(CLOCK) private readonly now: () => number,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<GatewayRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const bucket =
      this.reflector.getAllAndOverride<RateBucket>(RATE_BUCKET_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? "default";

    const { key, limit } = this.#resolve(bucket, request);
    const decision = await this.store.hit(key, limit, WINDOW_MS, this.now());

    response.setHeader("X-RateLimit-Limit", limit.toString());
    response.setHeader("X-RateLimit-Remaining", decision.remaining.toString());
    if (!decision.allowed) {
      response.setHeader("Retry-After", Math.ceil(decision.retryAfterMs / 1000).toString());
      throw new HttpException("Too many requests", 429);
    }
    return true;
  }

  #resolve(bucket: RateBucket, request: GatewayRequest): { key: string; limit: number } {
    if (bucket === "login") {
      return {
        key: `login:ip:${clientIp(request)}`,
        limit: this.env.RATE_LIMIT_LOGIN_PER_MINUTE,
      };
    }
    const principal = request.principal;
    const identity =
      principal === undefined
        ? `ip:${clientIp(request)}`
        : principal.kind === "api-key"
          ? `key:${principal.apiKeyId}`
          : `user:${principal.userId}`;
    return { key: identity, limit: this.env.RATE_LIMIT_PER_MINUTE };
  }
}
