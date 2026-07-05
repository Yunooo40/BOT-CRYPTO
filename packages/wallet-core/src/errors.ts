import { DomainError } from "@bot/errors";

/** No wallet with that id (or address) in the repository. Not retryable. */
export class WalletNotFoundError extends DomainError {
  override readonly code: string = "WALLET_NOT_FOUND";
}

/**
 * The keystore envelope failed authentication: corrupted/tampered data, an
 * envelope replayed against another wallet's address, or a wrong master key —
 * AES-GCM cannot (and should not) tell these apart. Never retryable.
 */
export class KeystoreIntegrityError extends DomainError {
  override readonly code: string = "KEYSTORE_INTEGRITY";
}
