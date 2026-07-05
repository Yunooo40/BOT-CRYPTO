import { randomUUID } from "node:crypto";
import { DuplicateApiKeyError, DuplicateEmailError } from "../errors";
import type {
  ApiKeyRecord,
  ApiKeyRepository,
  NewApiKey,
  NewUser,
  UserRecord,
  UserRepository,
} from "./repositories";

/**
 * Map-backed repository twins, mirroring the Postgres implementations'
 * observable behaviour (same errors, same revoke semantics) so e2e tests
 * exercise the real service logic without a database.
 */

export class InMemoryUserRepository implements UserRepository {
  readonly #users = new Map<string, UserRecord>();

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    return [...this.#users.values()].find((user) => user.email === email);
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    return this.#users.get(id);
  }

  async create(user: NewUser): Promise<UserRecord> {
    if (await this.findByEmail(user.email)) {
      throw new DuplicateEmailError(`A user with email "${user.email}" already exists`);
    }
    const now = new Date();
    const record: UserRecord = { id: randomUUID(), ...user, createdAt: now, updatedAt: now };
    this.#users.set(record.id, record);
    return record;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    const user = this.#users.get(id);
    if (user) {
      this.#users.set(id, { ...user, passwordHash, updatedAt: new Date() });
    }
  }
}

export class InMemoryApiKeyRepository implements ApiKeyRepository {
  readonly #keys = new Map<string, ApiKeyRecord>();

  async create(key: NewApiKey): Promise<ApiKeyRecord> {
    if (await this.findByHash(key.keyHash)) {
      throw new DuplicateApiKeyError("API key hash collision");
    }
    const record: ApiKeyRecord = {
      id: randomUUID(),
      ...key,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    };
    this.#keys.set(record.id, record);
    return record;
  }

  async findByHash(keyHash: string): Promise<ApiKeyRecord | undefined> {
    return [...this.#keys.values()].find((key) => key.keyHash === keyHash);
  }

  async listByUser(userId: string): Promise<ApiKeyRecord[]> {
    return [...this.#keys.values()].filter((key) => key.userId === userId);
  }

  async revoke(id: string, userId: string): Promise<boolean> {
    const key = this.#keys.get(id);
    if (!key || key.userId !== userId || key.revokedAt !== null) {
      return false;
    }
    this.#keys.set(id, { ...key, revokedAt: new Date() });
    return true;
  }

  async touchLastUsed(id: string, at: Date): Promise<void> {
    const key = this.#keys.get(id);
    if (key) {
      this.#keys.set(id, { ...key, lastUsedAt: at });
    }
  }
}
