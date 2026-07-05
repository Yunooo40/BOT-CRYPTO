import type { EventBus } from "@bot/events";
import type { Logger } from "@bot/logger";
import type { Address, ChainId, TradeIntent } from "@bot/domain";
import type { CopyPolicy, CopyStore, PositionSource, WatcherClient } from "./ports";
import { CopyRunner } from "./runner";
import { WalletWatcher } from "./watcher";

export interface AttachCopyOptions {
  bus: EventBus;
  store: CopyStore;
  client: WatcherClient;
  positions: PositionSource;
  policy?: CopyPolicy;
  logger?: Logger;
  chainId?: ChainId;
  referenceTokens?: Address[];
  maxBlockRange?: number;
  confirmations?: number;
  intervalMs?: number;
  now?: () => number;
  shieldGate?: (intent: TradeIntent) => Promise<boolean>;
}

/**
 * Build a {@link WalletWatcher} + {@link CopyRunner} from one options bag, start
 * the polling loop, and hand back the running runner plus a `stop`. Copy trading
 * is producer-side — driven by the chain, publishing `buy/sell.requested` onto
 * the bus — so there is nothing to subscribe to; this just wires the pieces and
 * owns their lifecycle.
 */
export function attachCopy(options: AttachCopyOptions): {
  runner: CopyRunner;
  stop: () => void;
} {
  const watcher = new WalletWatcher({
    client: options.client,
    store: options.store,
    referenceTokens: options.referenceTokens,
    logger: options.logger,
    chainId: options.chainId,
    maxBlockRange: options.maxBlockRange,
    confirmations: options.confirmations,
  });
  const runner = new CopyRunner({
    bus: options.bus,
    store: options.store,
    watcher,
    positions: options.positions,
    policy: options.policy,
    logger: options.logger,
    intervalMs: options.intervalMs,
    now: options.now,
    shieldGate: options.shieldGate,
  });
  runner.start();
  return { runner, stop: () => runner.stop() };
}
