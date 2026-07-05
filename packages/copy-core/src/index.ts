export { MAX_TRACKED_WALLETS, type CopyMode, type ObservedSwap, type TrackedWallet } from "./rules";
export type {
  CopyAction,
  CopyContext,
  CopyPolicy,
  CopyStore,
  PositionSource,
  WatcherClient,
} from "./ports";
export { defaultCopyPolicy } from "./policy";
export { assertWithinWalletLimit } from "./limit";
export { decodeSwaps, erc20Transfer, type TransferLog } from "./decode";
export { WalletWatcher, type WalletWatcherOptions } from "./watcher";
export { CopyRunner, type CopyRunnerOptions } from "./runner";
export { InMemoryCopyStore } from "./in-memory";
export { DrizzleCopyStore } from "./drizzle";
export { copiedSwaps, copyCursors, trackedWallets } from "./schema";
export { attachCopy, type AttachCopyOptions } from "./attach";
