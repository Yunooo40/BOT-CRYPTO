export { KeystoreIntegrityError, WalletNotFoundError } from "./errors";
export { Keystore } from "./keystore";
export type { WalletRecord, WalletRepository } from "./repository";
export { InMemoryWalletRepository } from "./in-memory";
export { DrizzleWalletRepository } from "./drizzle";
export { wallets } from "./schema";
export { WalletService, type WalletInfo, type WalletServiceOptions } from "./wallets";
