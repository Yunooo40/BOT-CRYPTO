import { bigint, boolean, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";

/** Drizzle schema — mirrored by `drizzle/0004_strategies.sql`. */
export const strategies = pgTable("strategies", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  chainId: integer("chain_id").notNull(),
  token: text("token").notNull(),
  walletId: text("wallet_id").notNull(),
  simulated: boolean("simulated").notNull(),
  status: text("status").notNull(),
  /** Pool, params and state travel as JSON — type-specific, versioned lightly. */
  pool: jsonb("pool").notNull(),
  params: jsonb("params").notNull(),
  state: jsonb("state").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
