import type { Address } from "@bot/domain";

/**
 * A stored wallet row. `encryptedKey` is the versioned keystore envelope —
 * never a clear private key. `tenantId` is null for the single-owner setup
 * and keeps the schema multi-tenant-ready.
 */
export interface WalletRecord {
  id: string;
  tenantId: string | null;
  label: string;
  address: Address;
  encryptedKey: string;
  createdAt: Date;
}

/** Persistence port. Implementations: in-memory (tests/paper), Drizzle/Postgres. */
export interface WalletRepository {
  insert(record: WalletRecord): Promise<void>;
  findById(id: string): Promise<WalletRecord | undefined>;
  findByAddress(address: Address): Promise<WalletRecord | undefined>;
  /** All wallets, oldest first. */
  list(): Promise<WalletRecord[]>;
}
