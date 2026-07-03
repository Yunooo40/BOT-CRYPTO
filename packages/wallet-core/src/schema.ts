import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Drizzle schema — mirrored by `drizzle/0001_wallets.sql`. */
export const wallets = pgTable(
  "wallets",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id"),
    label: text("label").notNull(),
    address: text("address").notNull(),
    /** Versioned AES-256-GCM envelope (`v1:salt:iv:ciphertext:tag`). */
    encryptedKey: text("encrypted_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    addressIdx: uniqueIndex("wallets_address_idx").on(table.address),
  }),
);
