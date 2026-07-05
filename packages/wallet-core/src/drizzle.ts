import { asc, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { toAddress, type Address } from "@bot/domain";
import type { WalletRecord, WalletRepository } from "./repository";
import { wallets } from "./schema";

type Row = typeof wallets.$inferSelect;

function toRecord(row: Row): WalletRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    label: row.label,
    address: toAddress(row.address),
    encryptedKey: row.encryptedKey,
    createdAt: row.createdAt,
  };
}

/** PostgreSQL persistence via Drizzle. Stores envelopes only — never clear keys. */
export class DrizzleWalletRepository implements WalletRepository {
  readonly #db: PostgresJsDatabase;

  constructor(db: PostgresJsDatabase) {
    this.#db = db;
  }

  /** Convenience: own connection from a URL. Call `close()` on shutdown. */
  static connect(databaseUrl: string): {
    repository: DrizzleWalletRepository;
    close: () => Promise<void>;
  } {
    const sql = postgres(databaseUrl, { max: 5 });
    return {
      repository: new DrizzleWalletRepository(drizzle(sql)),
      close: async () => {
        await sql.end();
      },
    };
  }

  async insert(record: WalletRecord): Promise<void> {
    await this.#db.insert(wallets).values(record);
  }

  async findById(id: string): Promise<WalletRecord | undefined> {
    const rows = await this.#db.select().from(wallets).where(eq(wallets.id, id)).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toRecord(row);
  }

  async findByAddress(address: Address): Promise<WalletRecord | undefined> {
    const rows = await this.#db.select().from(wallets).where(eq(wallets.address, address)).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toRecord(row);
  }

  async list(): Promise<WalletRecord[]> {
    const rows = await this.#db.select().from(wallets).orderBy(asc(wallets.createdAt));
    return rows.map(toRecord);
  }
}
