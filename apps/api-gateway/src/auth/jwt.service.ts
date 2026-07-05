import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@bot/config";
import { jwtVerify, SignJWT } from "jose";
import { ENV } from "../tokens";
import type { Role } from "./scopes";

const ISSUER = "bot-crypto";
const AUDIENCE = "bot-crypto:api";
const ROLES: readonly Role[] = ["admin", "viewer"];

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  email: string;
  role: Role;
}

/**
 * Stateless HS256 access tokens. One fixed algorithm, pinned issuer/audience —
 * `verify` rejects anything else, so downgrade tricks ("alg": "none", RS→HS
 * confusion) die at the door. Sessions live `JWT_TTL_SECONDS`; revocation
 * story in M12 is "rotate JWT_SECRET" (logout-everyone), per-session revocation
 * arrives with refresh tokens later.
 */
@Injectable()
export class JwtService {
  readonly #key: Uint8Array;
  readonly #ttlSeconds: number;

  constructor(@Inject(ENV) env: Env) {
    this.#key = new TextEncoder().encode(env.JWT_SECRET);
    this.#ttlSeconds = env.JWT_TTL_SECONDS;
  }

  get ttlSeconds(): number {
    return this.#ttlSeconds;
  }

  async sign(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ email: claims.email, role: claims.role })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + this.#ttlSeconds)
      .sign(this.#key);
  }

  /** Verify signature, expiry, issuer, audience and shape; undefined = reject. */
  async verify(token: string): Promise<AccessTokenClaims | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.#key, {
        algorithms: ["HS256"],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      const { sub, email, role } = payload;
      if (typeof sub !== "string" || typeof email !== "string" || !ROLES.includes(role as Role)) {
        return undefined;
      }
      return { sub, email, role: role as Role };
    } catch {
      return undefined;
    }
  }
}
