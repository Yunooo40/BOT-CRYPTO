import { Inject, Injectable } from "@nestjs/common";
import { API_KEY_REPOSITORY, CLOCK, USER_REPOSITORY } from "../tokens";
import { hashApiKey, looksLikeApiKey } from "./api-key";
import { JwtService } from "./jwt.service";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "./password";
import type { Principal } from "./principal";
import type { ApiKeyRepository, UserRepository } from "./repositories";
import { scopesForRole } from "./scopes";

export interface LoginResult {
  token: string;
  expiresInSeconds: number;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepository,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(CLOCK) private readonly now: () => number,
  ) {}

  /**
   * Email + password → access token, or undefined on any failure. Unknown
   * email burns a scrypt verification against a dummy hash so the two failure
   * modes are indistinguishable by timing.
   */
  async login(email: string, password: string): Promise<LoginResult | undefined> {
    const user = await this.users.findByEmail(email.toLowerCase());
    if (user === undefined) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      return undefined;
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      return undefined;
    }
    const token = await this.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return { token, expiresInSeconds: this.jwt.ttlSeconds };
  }

  /**
   * Bearer token (API key or JWT) → {@link Principal}, or undefined to reject.
   * JWT principals are re-anchored to the live user row, so a deleted user's
   * outstanding tokens stop working immediately.
   */
  async authenticate(token: string): Promise<Principal | undefined> {
    if (looksLikeApiKey(token)) {
      return this.#authenticateApiKey(token);
    }
    const claims = await this.jwt.verify(token);
    if (claims === undefined) {
      return undefined;
    }
    const user = await this.users.findById(claims.sub);
    if (user === undefined) {
      return undefined;
    }
    return {
      kind: "user",
      userId: user.id,
      email: user.email,
      role: user.role,
      scopes: scopesForRole(user.role),
    };
  }

  async #authenticateApiKey(token: string): Promise<Principal | undefined> {
    const record = await this.apiKeys.findByHash(hashApiKey(token));
    if (record === undefined || record.revokedAt !== null) {
      return undefined;
    }
    const now = new Date(this.now());
    if (record.expiresAt !== null && record.expiresAt.getTime() <= now.getTime()) {
      return undefined;
    }
    // Usage stamp is telemetry, not correctness — never block or fail auth on it.
    void this.apiKeys.touchLastUsed(record.id, now).catch(() => undefined);
    return {
      kind: "api-key",
      userId: record.userId,
      apiKeyId: record.id,
      scopes: record.scopes,
    };
  }
}
