import type { Role, Scope } from "./scopes";

/**
 * Persistence ports (Repository Pattern). The gateway owns two tables — users
 * and API keys — and talks to them only through these interfaces:
 * `PostgresUserRepository`/`PostgresApiKeyRepository` in production,
 * in-memory twins in tests and paper setups.
 */

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  role: Role;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | undefined>;
  findById(id: string): Promise<UserRecord | undefined>;
  /** @throws {DuplicateEmailError} when the email is already registered. */
  create(user: NewUser): Promise<UserRecord>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  /** Plaintext display prefix (`bk_1a2b3c4d`) — never the key itself. */
  prefix: string;
  /** SHA-256 of the full key, hex. */
  keyHash: string;
  scopes: Scope[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface NewApiKey {
  userId: string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: Scope[];
  expiresAt: Date | null;
}

export interface ApiKeyRepository {
  create(key: NewApiKey): Promise<ApiKeyRecord>;
  findByHash(keyHash: string): Promise<ApiKeyRecord | undefined>;
  listByUser(userId: string): Promise<ApiKeyRecord[]>;
  /**
   * Revoke a live key owned by `userId`. Returns false when there is nothing
   * to revoke — unknown id, someone else's key, or already revoked.
   */
  revoke(id: string, userId: string): Promise<boolean>;
  /** Best-effort usage stamp; failures must not fail the authenticated request. */
  touchLastUsed(id: string, at: Date): Promise<void>;
}
