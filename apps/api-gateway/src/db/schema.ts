import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { Scope } from "../auth/scopes";

/**
 * The gateway's own tables. Per the architecture, each service owns its slice
 * of the database — no other service reads these directly.
 *
 * Multi-tenant-ready: everything an owner touches hangs off `users.id`.
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "viewer"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Display prefix (`bk_1a2b3c4d`) — identification only, not a secret. */
    prefix: text("prefix").notNull(),
    /** SHA-256 hex of the full key. The key itself is never stored. */
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes").array().notNull().$type<Scope[]>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("api_keys_user_id_idx").on(table.userId)],
);

/**
 * The gateway's own read-model for the dashboard (M13), built by replaying
 * `trade.executed` off the bus (see `portfolio/ingestor.ts`) — never by
 * reading another service's tables directly. `id` is the trade id, so a
 * redelivered event is a no-op insert (`onConflictDoNothing`).
 */
export const tradeHistory = pgTable(
  "trade_history",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    token: text("token").notNull(),
    /**
     * Base units + decimals: a buy's `amountIn` is the quote asset, a sell's
     * `amountOut` is. `numeric` (not `bigint`): a token's base-unit amount at 18
     * decimals routinely exceeds int64 (e.g. a cheap memecoin snipe), so an
     * int64 column would reject the insert.
     */
    amountIn: numeric("amount_in", { mode: "bigint" }).notNull(),
    amountInDecimals: integer("amount_in_decimals").notNull(),
    amountOut: numeric("amount_out", { mode: "bigint" }).notNull(),
    amountOutDecimals: integer("amount_out_decimals").notNull(),
    txHash: text("tx_hash").notNull(),
    simulated: boolean("simulated").notNull(),
    occurredAt: bigint("occurred_at", { mode: "number" }).notNull(),
  },
  (table) => [index("trade_history_occurred_at_idx").on(table.occurredAt)],
);

/**
 * Positions folded from the same `trade.executed` stream via
 * `@bot/engine-core`'s pure `applyTrade`. Deliberately its own table (not the
 * Trading Engine's `positions` table): the gateway must keep working even if
 * the engine's storage changes shape.
 */
export const portfolioPositions = pgTable("portfolio_positions", {
  id: text("id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  token: text("token").notNull(),
  simulated: boolean("simulated").notNull(),
  // `numeric`, not `bigint`: token base-unit amounts at 18 decimals exceed int64.
  amount: numeric("amount", { mode: "bigint" }).notNull(),
  costBasis: numeric("cost_basis", { mode: "bigint" }).notNull(),
  realizedPnl: numeric("realized_pnl", { mode: "bigint" }).notNull(),
  openedAt: bigint("opened_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

/**
 * Append-only audit trail (M14), one row per money-moving action, built by the
 * observability core's `Auditor` off the bus. `id` is the source event id, so a
 * redelivered event is a no-op insert (`onConflictDoNothing`). `user_id` is a
 * plain string, not a FK: the referenced owner lives in another service's slice.
 * `detail` never holds a secret — the mappers only copy non-sensitive fields.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    action: text("action").notNull(),
    occurredAt: bigint("occurred_at", { mode: "number" }).notNull(),
    correlationId: text("correlation_id").notNull(),
    userId: text("user_id"),
    source: text("source").notNull(),
    outcome: text("outcome", { enum: ["success", "failure"] }).notNull(),
    subject: text("subject"),
    detail: jsonb("detail").notNull().$type<Record<string, string | number | boolean>>(),
  },
  (table) => [
    index("audit_log_occurred_at_idx").on(table.occurredAt),
    index("audit_log_correlation_id_idx").on(table.correlationId),
  ],
);
