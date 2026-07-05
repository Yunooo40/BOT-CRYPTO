import { assertWithinWalletLimit } from "./limit";
import type { CopyStore } from "./ports";
import type { TrackedWallet } from "./rules";

const copiedKey = (walletId: string, txHash: string, logIndex: number): string =>
  `${walletId}:${txHash}:${logIndex}`;

/** In-process copy store for tests and paper trading. */
export class InMemoryCopyStore implements CopyStore {
  readonly #wallets = new Map<string, TrackedWallet>();
  readonly #cursors = new Map<string, bigint>();
  readonly #copied = new Set<string>();

  async upsertWallet(wallet: TrackedWallet): Promise<void> {
    const activeIds = [...this.#wallets.values()].filter((w) => w.enabled).map((w) => w.id);
    assertWithinWalletLimit(activeIds, wallet);
    this.#wallets.set(wallet.id, structuredClone(wallet));
  }

  async getWallet(id: string): Promise<TrackedWallet | undefined> {
    const wallet = this.#wallets.get(id);
    return wallet === undefined ? undefined : structuredClone(wallet);
  }

  async listActiveWallets(): Promise<TrackedWallet[]> {
    return [...this.#wallets.values()]
      .filter((wallet) => wallet.enabled)
      .map((wallet) => structuredClone(wallet));
  }

  async listWallets(): Promise<TrackedWallet[]> {
    return [...this.#wallets.values()].map((wallet) => structuredClone(wallet));
  }

  async getCursor(walletId: string): Promise<bigint | undefined> {
    return this.#cursors.get(walletId);
  }

  async setCursor(walletId: string, lastScannedBlock: bigint): Promise<void> {
    this.#cursors.set(walletId, lastScannedBlock);
  }

  async hasCopied(walletId: string, txHash: string, logIndex: number): Promise<boolean> {
    return this.#copied.has(copiedKey(walletId, txHash, logIndex));
  }

  async markCopied(walletId: string, txHash: string, logIndex: number): Promise<void> {
    this.#copied.add(copiedKey(walletId, txHash, logIndex));
  }
}
