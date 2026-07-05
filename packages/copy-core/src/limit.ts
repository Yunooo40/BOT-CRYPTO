import { ValidationError } from "@bot/errors";
import { MAX_TRACKED_WALLETS } from "./rules";

/**
 * Enforce the follow cap. `activeIds` are the currently enabled wallet ids; a
 * new enabled wallet is rejected once the cap is reached. Re-enabling or
 * updating an already-counted wallet is always allowed.
 */
export function assertWithinWalletLimit(
  activeIds: Iterable<string>,
  wallet: { id: string; enabled: boolean },
): void {
  if (!wallet.enabled) return;
  const ids = new Set(activeIds);
  if (ids.has(wallet.id)) return;
  if (ids.size >= MAX_TRACKED_WALLETS) {
    throw new ValidationError(`cannot follow more than ${MAX_TRACKED_WALLETS} wallets`, {
      context: { limit: MAX_TRACKED_WALLETS, walletId: wallet.id },
    });
  }
}
