import { bigint, boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Drizzle schema — mirrored by `drizzle/0005_copy.sql`. */

export const trackedWallets = pgTable("tracked_wallets", {
  id: text("id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  address: text("address").notNull(),
  label: text("label"),
  simulated: boolean("simulated").notNull(),
  copySells: boolean("copy_sells").notNull(),
  enabled: boolean("enabled").notNull(),
  /** Sizing config (mode, bps, amounts, allow/deny lists) — bigint-safe JSON. */
  config: jsonb("config").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const copyCursors = pgTable("copy_cursors", {
  walletId: text("wallet_id").primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const copiedSwaps = pgTable("copied_swaps", {
  key: text("key").primaryKey(),
  copiedAt: timestamp("copied_at", { withTimezone: true }).notNull().defaultNow(),
});
