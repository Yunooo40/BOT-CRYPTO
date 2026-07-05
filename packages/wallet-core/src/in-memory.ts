import type { Address } from "@bot/domain";
import { ValidationError } from "@bot/errors";
import type { WalletRecord, WalletRepository } from "./repository";

/** In-process repository for tests and paper trading — no database required. */
export class InMemoryWalletRepository implements WalletRepository {
  readonly #records = new Map<string, WalletRecord>();

  async insert(record: WalletRecord): Promise<void> {
    if (this.#records.has(record.id)) {
      throw new ValidationError(`Duplicate wallet id: ${record.id}`);
    }
    for (const existing of this.#records.values()) {
      if (existing.address === record.address) {
        throw new ValidationError(`Wallet address already stored: ${record.address}`);
      }
    }
    this.#records.set(record.id, { ...record });
  }

  async findById(id: string): Promise<WalletRecord | undefined> {
    const record = this.#records.get(id);
    return record === undefined ? undefined : { ...record };
  }

  async findByAddress(address: Address): Promise<WalletRecord | undefined> {
    for (const record of this.#records.values()) {
      if (record.address === address) {
        return { ...record };
      }
    }
    return undefined;
  }

  async list(): Promise<WalletRecord[]> {
    return [...this.#records.values()]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((record) => ({ ...record }));
  }
}
