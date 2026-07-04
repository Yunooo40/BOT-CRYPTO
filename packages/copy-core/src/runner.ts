import { createEvent, type EventBus } from "@bot/events";
import { createLogger, type Logger } from "@bot/logger";
import type { TradeIntent } from "@bot/domain";
import { defaultCopyPolicy } from "./policy";
import type { CopyPolicy, CopyStore, PositionSource } from "./ports";
import type { ObservedSwap, TrackedWallet } from "./rules";
import { WalletWatcher } from "./watcher";

export interface CopyRunnerOptions {
  bus: EventBus;
  store: CopyStore;
  watcher: WalletWatcher;
  positions: PositionSource;
  policy?: CopyPolicy;
  logger?: Logger;
  /** Tick period once started. Default 3 000 ms. */
  intervalMs?: number;
  now?: () => number;
  /**
   * Optional pre-trade gate for copied *buys* (e.g. the Rugpull Shield, M6).
   * Returns `false` to veto the buy. Off by default — kept a decoupled hook.
   */
  shieldGate?: (intent: TradeIntent) => Promise<boolean>;
}

/**
 * Ties the watcher, the policy and the bus together: for each new swap of a
 * followed wallet, size the copy, optionally gate it, and publish
 * `buy.requested` / `sell.requested` (`source: "copy"`). Every processed swap
 * is marked copied — so an at-least-once redelivery or a restart replaying a
 * range never mirrors it twice.
 */
export class CopyRunner {
  readonly #bus: EventBus;
  readonly #store: CopyStore;
  readonly #watcher: WalletWatcher;
  readonly #positions: PositionSource;
  readonly #policy: CopyPolicy;
  readonly #logger: Logger;
  readonly #intervalMs: number;
  readonly #now: () => number;
  readonly #shieldGate: ((intent: TradeIntent) => Promise<boolean>) | undefined;

  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: CopyRunnerOptions) {
    this.#bus = options.bus;
    this.#store = options.store;
    this.#watcher = options.watcher;
    this.#positions = options.positions;
    this.#policy = options.policy ?? defaultCopyPolicy;
    this.#logger = options.logger ?? createLogger({ name: "copy" });
    this.#intervalMs = options.intervalMs ?? 3_000;
    this.#now = options.now ?? Date.now;
    this.#shieldGate = options.shieldGate;
  }

  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => void this.tick(), this.#intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  /** Scan and process every active wallet once. Deterministic — the tests drive it. */
  async tick(): Promise<void> {
    const wallets = await this.#store.listActiveWallets();
    for (const wallet of wallets) {
      try {
        const { swaps } = await this.#watcher.scan(wallet);
        for (const swap of swaps) {
          await this.#handle(wallet, swap);
        }
      } catch (error) {
        this.#logger.warn({ err: error, wallet: wallet.id }, "copy tick failed for wallet");
      }
    }
  }

  async #handle(wallet: TrackedWallet, swap: ObservedSwap): Promise<void> {
    if (await this.#store.hasCopied(swap.walletId, swap.txHash, swap.logIndex)) {
      return;
    }
    const heldAmount = await this.#positions.amountOf(wallet.chainId, swap.token, wallet.simulated);
    const action = this.#policy.evaluate({ wallet, swap, heldAmount, now: this.#now() });

    if (action.kind === "skip") {
      this.#logger.debug(
        { wallet: wallet.id, token: swap.token, side: swap.side, reason: action.reason },
        "copy skipped",
      );
      await this.#store.markCopied(swap.walletId, swap.txHash, swap.logIndex);
      return;
    }

    const intent = action.intent;
    if (intent.side === "buy" && this.#shieldGate !== undefined) {
      const allowed = await this.#shieldGate(intent);
      if (!allowed) {
        this.#logger.info({ wallet: wallet.id, token: swap.token }, "copy buy vetoed by shield");
        await this.#store.markCopied(swap.walletId, swap.txHash, swap.logIndex);
        return;
      }
    }

    const type = intent.side === "buy" ? "buy.requested" : "sell.requested";
    await this.#bus.publish(
      createEvent(type, { intent }, { source: "copy", correlationId: swap.txHash }),
    );
    await this.#store.markCopied(swap.walletId, swap.txHash, swap.logIndex);
    this.#logger.info(
      { wallet: wallet.id, token: swap.token, side: intent.side },
      "copied leader swap",
    );
  }
}
