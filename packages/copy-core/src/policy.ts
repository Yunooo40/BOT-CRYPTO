import { tokenAmount, type TradeIntent } from "@bot/domain";
import type { CopyAction, CopyContext, CopyPolicy } from "./ports";
import type { ObservedSwap, TrackedWallet } from "./rules";

const BPS = 10_000n;

function buyIntent(wallet: TrackedWallet, swap: ObservedSwap, amountIn: bigint): TradeIntent {
  return {
    chainId: wallet.chainId,
    side: "buy",
    token: swap.token,
    amountIn: tokenAmount(amountIn, 0),
    maxSlippageBps: wallet.maxSlippageBps,
    simulated: wallet.simulated,
  };
}

function sellIntent(wallet: TrackedWallet, swap: ObservedSwap, amountIn: bigint): TradeIntent {
  return {
    chainId: wallet.chainId,
    side: "sell",
    token: swap.token,
    amountIn: tokenAmount(amountIn, 0),
    maxSlippageBps: wallet.maxSlippageBps,
    simulated: wallet.simulated,
  };
}

/** Buy sizing: `sizeBps` of the leader's spend (percent) or a fixed amount. */
function sizeBuy(wallet: TrackedWallet, swap: ObservedSwap): bigint {
  if (wallet.mode === "fixed") {
    return wallet.fixedAmountIn ?? 0n;
  }
  const bps = BigInt(wallet.sizeBps ?? 0);
  return (swap.amountIn * bps) / BPS;
}

/**
 * The default copy policy. Deterministic and side-effect free:
 *
 * - **Allow/deny lists.** A token on the deny-list is never copied; when an
 *   allow-list is set, only its tokens are.
 * - **Buys.** Sized from the leader's spend (`percent`) or a fixed amount,
 *   skipped below `minAmountIn`, clamped to `maxAmountIn`.
 * - **Sells.** Mirrored out of *our* position (`copySells`): `sizeBps` of what
 *   we hold in `percent` mode, the whole position in `fixed` mode — capped at
 *   the held amount. We can't observe the leader's balance, so we scale against
 *   our own holdings rather than guess theirs. A flat position skips.
 *
 * Every non-emit path returns a motivated `skip` — the runner never emits
 * silently, and the reason is logged.
 */
export const defaultCopyPolicy: CopyPolicy = {
  evaluate(ctx: CopyContext): CopyAction {
    const { wallet, swap, heldAmount } = ctx;

    if (wallet.denyTokens?.includes(swap.token)) {
      return { kind: "skip", reason: "token on deny-list" };
    }
    if (wallet.allowTokens !== undefined && wallet.allowTokens.length > 0) {
      if (!wallet.allowTokens.includes(swap.token)) {
        return { kind: "skip", reason: "token not on allow-list" };
      }
    }

    if (swap.side === "buy") {
      let amount = sizeBuy(wallet, swap);
      if (wallet.maxAmountIn !== undefined && amount > wallet.maxAmountIn) {
        amount = wallet.maxAmountIn;
      }
      if (amount === 0n) {
        return { kind: "skip", reason: "sized buy amount is zero" };
      }
      if (wallet.minAmountIn !== undefined && amount < wallet.minAmountIn) {
        return { kind: "skip", reason: "sized buy amount below minimum" };
      }
      return { kind: "emit", intent: buyIntent(wallet, swap, amount) };
    }

    // Sell.
    if (!wallet.copySells) {
      return { kind: "skip", reason: "sell copying disabled" };
    }
    if (heldAmount === 0n) {
      return { kind: "skip", reason: "no position to mirror the sell" };
    }
    const amount =
      wallet.mode === "fixed" ? heldAmount : (heldAmount * BigInt(wallet.sizeBps ?? 0)) / BPS;
    const capped = amount > heldAmount ? heldAmount : amount;
    if (capped === 0n) {
      return { kind: "skip", reason: "sized sell amount is zero" };
    }
    return { kind: "emit", intent: sellIntent(wallet, swap, capped) };
  },
};
