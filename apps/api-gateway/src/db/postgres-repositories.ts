import { InfraError } from "@bot/errors";
import { and, eq, isNull } from "drizzle-orm";
import { DuplicateApiKeyError, DuplicateEmailError } from "../errors";
import type {
  ApiKeyRecord,
  ApiKeyRepository,
  NewApiKey,
  NewUser,
  UserRecord,
  UserRepository,
} from "../auth/repositories";
import type { Database } from "./client";
import { apiKeys, users } from "./schema";

/** Postgres unique_violation — the driver error hides down the cause chain. */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current !== null && typeof current === "object";) {
    if ((current as { code?: unknown }).code === "23505") {
      return true;
    }
    current = (current as { cause?: unknown }).cause ?? null;
  }
  return false;
}

/** Anything else the database throws is infrastructure: retryable, 503. */
function wrapDbError(error: unknown, operation: string): never {
  throw new InfraError(`database operation failed: ${operation}`, { cause: error });
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    try {
      const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
      return rows[0];
    } catch (error) {
      wrapDbError(error, "users.findByEmail");
    }
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    try {
      const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
      return rows[0];
    } catch (error) {
      wrapDbError(error, "users.findById");
    }
  }

  async create(user: NewUser): Promise<UserRecord> {
    try {
      const rows = await this.db.insert(users).values(user).returning();
      const created = rows[0];
      if (created === undefined) {
        throw new InfraError("insert returned no row");
      }
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateEmailError(`A user with email "${user.email}" already exists`);
      }
      wrapDbError(error, "users.create");
    }
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    try {
      await this.db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, id));
    } catch (error) {
      wrapDbError(error, "users.updatePasswordHash");
    }
  }
}

export class PostgresApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: Database) {}

  async create(key: NewApiKey): Promise<ApiKeyRecord> {
    try {
      const rows = await this.db.insert(apiKeys).values(key).returning();
      const created = rows[0];
      if (created === undefined) {
        throw new InfraError("insert returned no row");
      }
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateApiKeyError("API key hash collision");
      }
      wrapDbError(error, "apiKeys.create");
    }
  }

  async findByHash(keyHash: string): Promise<ApiKeyRecord | undefined> {
    try {
      const rows = await this.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, keyHash))
        .limit(1);
      return rows[0];
    } catch (error) {
      wrapDbError(error, "apiKeys.findByHash");
    }
  }

  async listByUser(userId: string): Promise<ApiKeyRecord[]> {
    try {
      return await this.db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
    } catch (error) {
      wrapDbError(error, "apiKeys.listByUser");
    }
  }

  async revoke(id: string, userId: string): Promise<boolean> {
    try {
      const rows = await this.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id });
      return rows.length > 0;
    } catch (error) {
      wrapDbError(error, "apiKeys.revoke");
    }
  }

  async touchLastUsed(id: string, at: Date): Promise<void> {
    try {
      await this.db.update(apiKeys).set({ lastUsedAt: at }).where(eq(apiKeys.id, id));
    } catch (error) {
      wrapDbError(error, "apiKeys.touchLastUsed");
    }
  }
}
