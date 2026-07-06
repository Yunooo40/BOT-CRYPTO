import { toAddress, type Address, type ChainId } from "@bot/domain";
import type { PositionRecord, PositionStore } from "@bot/engine-core";
import { InfraError } from "@bot/errors";
import type { AuditRecord, AuditSink } from "@bot/observability-core";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { DuplicateApiKeyError, DuplicateEmailError } from "../errors";
import type {
  ApiKeyRecord,
  ApiKeyRepository,
  NewApiKey,
  NewUser,
  UserRecord,
  UserRepository,
} from "../auth/repositories";
import {
  decodeCursor,
  encodeCursor,
  type TradeHistoryPage,
  type TradeHistoryQuery,
  type TradeHistoryRecord,
  type TradeHistoryRepository,
} from "../portfolio/trade-history";
import type { Database } from "./client";
import { apiKeys, auditLog, portfolioPositions, tradeHistory, users } from "./schema";

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

type TradeHistoryRow = typeof tradeHistory.$inferSelect;

function toTradeHistoryRecord(row: TradeHistoryRow): TradeHistoryRecord {
  return {
    id: row.id,
    chainId: row.chainId as ChainId,
    side: row.side,
    token: toAddress(row.token),
    amountIn: { raw: row.amountIn, decimals: row.amountInDecimals },
    amountOut: { raw: row.amountOut, decimals: row.amountOutDecimals },
    txHash: row.txHash,
    simulated: row.simulated,
    occurredAt: row.occurredAt,
  };
}

export class DrizzleTradeHistoryRepository implements TradeHistoryRepository {
  constructor(private readonly db: Database) {}

  async append(record: TradeHistoryRecord): Promise<void> {
    try {
      await this.db
        .insert(tradeHistory)
        .values({
          id: record.id,
          chainId: record.chainId,
          side: record.side,
          token: record.token,
          amountIn: record.amountIn.raw,
          amountInDecimals: record.amountIn.decimals,
          amountOut: record.amountOut.raw,
          amountOutDecimals: record.amountOut.decimals,
          txHash: record.txHash,
          simulated: record.simulated,
          occurredAt: record.occurredAt,
        })
        .onConflictDoNothing({ target: tradeHistory.id });
    } catch (error) {
      wrapDbError(error, "tradeHistory.append");
    }
  }

  async list(query: TradeHistoryQuery): Promise<TradeHistoryPage> {
    try {
      const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      const beforeCursor =
        cursor === undefined
          ? undefined
          : or(
              lt(tradeHistory.occurredAt, cursor.occurredAt),
              and(eq(tradeHistory.occurredAt, cursor.occurredAt), lt(tradeHistory.id, cursor.id)),
            );
      const rows = await this.db
        .select()
        .from(tradeHistory)
        .where(beforeCursor)
        .orderBy(desc(tradeHistory.occurredAt), desc(tradeHistory.id))
        .limit(query.limit + 1);
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page[page.length - 1];
      return {
        items: page.map(toTradeHistoryRecord),
        ...(hasMore && last !== undefined
          ? { nextCursor: encodeCursor({ occurredAt: last.occurredAt, id: last.id }) }
          : {}),
      };
    } catch (error) {
      wrapDbError(error, "tradeHistory.list");
    }
  }

  async listAll(): Promise<TradeHistoryRecord[]> {
    try {
      const rows = await this.db.select().from(tradeHistory).orderBy(tradeHistory.occurredAt);
      return rows.map(toTradeHistoryRecord);
    } catch (error) {
      wrapDbError(error, "tradeHistory.listAll");
    }
  }
}

type PortfolioPositionRow = typeof portfolioPositions.$inferSelect;

function toPositionRecord(row: PortfolioPositionRow): PositionRecord {
  return {
    id: row.id,
    chainId: row.chainId as ChainId,
    token: toAddress(row.token),
    simulated: row.simulated,
    amount: row.amount,
    costBasis: row.costBasis,
    realizedPnl: row.realizedPnl,
    openedAt: row.openedAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The gateway's own position book (M13), folded from `trade.executed` via
 * `@bot/engine-core`'s `applyTrade` — see `db/schema.ts` for why this is a
 * separate table from the Trading Engine's.
 */
export class DrizzlePortfolioPositionsRepository implements PositionStore {
  constructor(private readonly db: Database) {}

  async get(
    chainId: ChainId,
    token: Address,
    simulated: boolean,
  ): Promise<PositionRecord | undefined> {
    try {
      const rows = await this.db
        .select()
        .from(portfolioPositions)
        .where(
          and(
            eq(portfolioPositions.chainId, chainId),
            eq(portfolioPositions.token, token),
            eq(portfolioPositions.simulated, simulated),
          ),
        )
        .limit(1);
      return rows[0] === undefined ? undefined : toPositionRecord(rows[0]);
    } catch (error) {
      wrapDbError(error, "portfolioPositions.get");
    }
  }

  async upsert(record: PositionRecord): Promise<void> {
    try {
      await this.db
        .insert(portfolioPositions)
        .values(record)
        .onConflictDoUpdate({
          target: portfolioPositions.id,
          set: {
            amount: record.amount,
            costBasis: record.costBasis,
            realizedPnl: record.realizedPnl,
            updatedAt: record.updatedAt,
          },
        });
    } catch (error) {
      wrapDbError(error, "portfolioPositions.upsert");
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.db.delete(portfolioPositions).where(eq(portfolioPositions.id, id));
    } catch (error) {
      wrapDbError(error, "portfolioPositions.remove");
    }
  }

  async list(): Promise<PositionRecord[]> {
    try {
      const rows = await this.db.select().from(portfolioPositions);
      return rows.map(toPositionRecord);
    } catch (error) {
      wrapDbError(error, "portfolioPositions.list");
    }
  }
}

/**
 * Append-only audit sink (M14). Idempotent on the source event id — a
 * redelivered event is a no-op insert, not a duplicate row.
 */
export class PostgresAuditSink implements AuditSink {
  constructor(private readonly db: Database) {}

  async record(record: AuditRecord): Promise<void> {
    try {
      await this.db
        .insert(auditLog)
        .values({
          id: record.id,
          action: record.action,
          occurredAt: record.occurredAt,
          correlationId: record.correlationId,
          userId: record.userId,
          source: record.source,
          outcome: record.outcome,
          subject: record.subject,
          detail: record.detail,
        })
        .onConflictDoNothing({ target: auditLog.id });
    } catch (error) {
      wrapDbError(error, "auditLog.record");
    }
  }
}
