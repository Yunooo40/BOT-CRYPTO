import { BASE_WETH, asHex } from "@bot/dex-adapters";
import { SUPPORTED_CHAINS, type Address, type ChainId } from "@bot/domain";
import { createLogger, type Logger } from "@bot/logger";
import { decodeSwaps, erc20Transfer, type TransferLog } from "./decode";
import type { CopyStore, WatcherClient } from "./ports";
import type { ObservedSwap, TrackedWallet } from "./rules";

export interface WalletWatcherOptions {
  client: WatcherClient;
  store: CopyStore;
  /** Quote tokens that mark the reference leg of a swap. Default `[WETH]` on Base. */
  referenceTokens?: Address[];
  logger?: Logger;
  chainId?: ChainId;
  /** Max blocks per `eth_getLogs` (providers cap ranges). Default 2 000. */
  maxBlockRange?: number;
  /** Blocks behind head to scan (cheap reorg guard). Default 1. */
  confirmations?: number;
}

/**
 * Reads a tracked wallet's ERC20 `Transfer` logs over a bounded block range and
 * reconstructs its swaps. A persistent per-wallet cursor resumes cleanly after a
 * restart — no gap, no full rescan; the first run starts at the head, so only
 * *new* activity is copied. Decoding is defensive (see {@link decodeSwaps}); the
 * caller (the runner) handles dedup and back-off.
 */
export class WalletWatcher {
  readonly #client: WatcherClient;
  readonly #store: CopyStore;
  readonly #referenceTokens: Address[];
  readonly #logger: Logger;
  readonly #chainId: ChainId;
  readonly #maxBlockRange: bigint;
  readonly #confirmations: bigint;

  constructor(options: WalletWatcherOptions) {
    this.#client = options.client;
    this.#store = options.store;
    this.#referenceTokens = options.referenceTokens ?? [BASE_WETH];
    this.#logger = options.logger ?? createLogger({ name: "copy-watcher" });
    this.#chainId = options.chainId ?? SUPPORTED_CHAINS.base;
    this.#maxBlockRange = BigInt(options.maxBlockRange ?? 2_000);
    this.#confirmations = BigInt(options.confirmations ?? 1);
  }

  /**
   * Scan the next block range for one wallet and return the swaps decoded from
   * it. Advances (and persists) the cursor to the last block scanned. Returns
   * `caughtUp` so the caller can keep chewing a backlog without waiting.
   */
  async scan(wallet: TrackedWallet): Promise<{ swaps: ObservedSwap[]; caughtUp: boolean }> {
    const head = await this.#client.getBlockNumber();
    const safeHead = head - this.#confirmations;
    const cursor = await this.#store.getCursor(wallet.id);
    if (cursor === undefined) {
      // First run: watch for new activity only — history is not our job.
      await this.#store.setCursor(wallet.id, safeHead);
      return { swaps: [], caughtUp: true };
    }
    if (safeHead <= cursor) {
      return { swaps: [], caughtUp: true };
    }
    const fromBlock = cursor + 1n;
    const maxTo = cursor + this.#maxBlockRange;
    const toBlock = safeHead < maxTo ? safeHead : maxTo;

    const address = asHex(wallet.address);
    // Two queries: transfers *from* and *to* the wallet (indexed args).
    const [sent, received] = await Promise.all([
      this.#client.getLogs({
        event: erc20Transfer,
        args: { from: address },
        fromBlock,
        toBlock,
        strict: true,
      }),
      this.#client.getLogs({
        event: erc20Transfer,
        args: { to: address },
        fromBlock,
        toBlock,
        strict: true,
      }),
    ]);

    const logs = [...sent, ...received] as unknown as TransferLog[];
    const swaps = decodeSwaps(logs, wallet, this.#referenceTokens, this.#chainId);
    await this.#store.setCursor(wallet.id, toBlock);
    this.#logger.debug(
      { wallet: wallet.id, fromBlock, toBlock, swaps: swaps.length },
      "scanned wallet range",
    );
    return { swaps, caughtUp: toBlock >= safeHead };
  }
}
