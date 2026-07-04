import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Drizzle schema — mirrored by `drizzle/0002_scanner.sql`. */

export const scanCursors = pgTable("scan_cursors", {
  dex: text("dex").primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const seenPools = pgTable("seen_pools", {
  address: text("address").primaryKey(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
});
