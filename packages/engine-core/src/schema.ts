import { bigint, boolean, integer, pgTable, text } from "drizzle-orm/pg-core";

/** Drizzle schema — mirrored by `drizzle/0003_positions.sql`. */
export const positions = pgTable("positions", {
  id: text("id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  token: text("token").notNull(),
  simulated: boolean("simulated").notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  costBasis: bigint("cost_basis", { mode: "bigint" }).notNull(),
  realizedPnl: bigint("realized_pnl", { mode: "bigint" }).notNull(),
  openedAt: bigint("opened_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
