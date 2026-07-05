import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
