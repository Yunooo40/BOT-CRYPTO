import type { Address, Dex } from "@bot/domain";
import type { ScanCursorStore, SeenPoolStore } from "./ports";

/** Volatile scan state for tests and paper trading. */
export class InMemoryScanState implements ScanCursorStore, SeenPoolStore {
  readonly #cursors = new Map<Dex, bigint>();
  readonly #seen = new Set<Address>();

  async get(dex: Dex): Promise<bigint | undefined> {
    return this.#cursors.get(dex);
  }

  async set(dex: Dex, lastScannedBlock: bigint): Promise<void> {
    this.#cursors.set(dex, lastScannedBlock);
  }

  async has(pool: Address): Promise<boolean> {
    return this.#seen.has(pool);
  }

  async add(pool: Address): Promise<void> {
    this.#seen.add(pool);
  }
}
