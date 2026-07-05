import { toAddress, type Address, type ChainId } from "@bot/domain";
import { parseAbiItem } from "viem";
import type { ObservedSwap, TrackedWallet } from "./rules";

/** ERC20 Transfer — the only log we need to reconstruct a swap venue-agnostically. */
export const erc20Transfer = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/**
 * A decoded `Transfer` log touching the watched wallet. `args` arrives from
 * viem's `getLogs` with the ABI attached, so `from`/`to`/`value` are decoded.
 */
export interface TransferLog {
  address: string;
  transactionHash: string | null;
  logIndex: number | null;
  blockNumber: bigint | null;
  args: { from?: string; to?: string; value?: bigint };
}

interface Leg {
  token: Address;
  amount: bigint;
  logIndex: number;
}

/** Largest leg wins; ties break on the lower address for determinism. */
function pickLeg(legs: Leg[]): Leg | undefined {
  return legs.reduce<Leg | undefined>((best, leg) => {
    if (best === undefined) return leg;
    if (leg.amount > best.amount) return leg;
    if (leg.amount === best.amount && leg.token < best.token) return leg;
    return best;
  }, undefined);
}

function isReference(token: Address, referenceTokens: Address[]): boolean {
  return referenceTokens.includes(token);
}

/**
 * Reconstruct the swaps a wallet performed from the `Transfer` logs of a block
 * range. Logs are grouped by transaction; within a transaction, the tokens the
 * wallet *sent* and *received* are paired:
 *
 * - reference sent + token received → **buy** of that token
 * - token sent + reference received → **sell** of that token
 *
 * Anything else (token-to-token, no reference leg, both directions) is skipped
 * rather than guessed — the decoder is defensive, not clever. When several
 * tokens move on one side, the largest leg is chosen deterministically.
 */
export function decodeSwaps(
  logs: TransferLog[],
  wallet: TrackedWallet,
  referenceTokens: Address[],
  chainId: ChainId,
): ObservedSwap[] {
  const byTx = new Map<string, { sent: Leg[]; recv: Leg[]; block: bigint }>();

  for (const log of logs) {
    const { transactionHash, logIndex, blockNumber } = log;
    const from = log.args.from;
    const to = log.args.to;
    const value = log.args.value;
    if (
      transactionHash === null ||
      logIndex === null ||
      blockNumber === null ||
      typeof from !== "string" ||
      typeof to !== "string" ||
      typeof value !== "bigint"
    ) {
      continue;
    }
    const token = toAddress(log.address);
    const fromWallet = toAddress(from) === wallet.address;
    const toWallet = toAddress(to) === wallet.address;
    if (fromWallet === toWallet) {
      // Neither leg touches the wallet, or a self-transfer — irrelevant.
      continue;
    }
    const entry = byTx.get(transactionHash) ?? { sent: [], recv: [], block: blockNumber };
    (fromWallet ? entry.sent : entry.recv).push({ token, amount: value, logIndex });
    byTx.set(transactionHash, entry);
  }

  const swaps: ObservedSwap[] = [];
  for (const [txHash, { sent, recv, block }] of byTx) {
    const refSent = sent.filter((leg) => isReference(leg.token, referenceTokens));
    const refRecv = recv.filter((leg) => isReference(leg.token, referenceTokens));
    const tokenSent = sent.filter((leg) => !isReference(leg.token, referenceTokens));
    const tokenRecv = recv.filter((leg) => !isReference(leg.token, referenceTokens));

    const boughtRef = pickLeg(refSent);
    const boughtToken = pickLeg(tokenRecv);
    const soldRef = pickLeg(refRecv);
    const soldToken = pickLeg(tokenSent);

    const isBuy = boughtRef !== undefined && boughtToken !== undefined;
    const isSell = soldRef !== undefined && soldToken !== undefined;
    // Ambiguous (looks like both, e.g. a multi-hop routing through the wallet)
    // or incomplete — skip rather than mis-copy.
    if (isBuy === isSell) {
      continue;
    }

    if (isBuy && boughtRef !== undefined && boughtToken !== undefined) {
      swaps.push({
        walletId: wallet.id,
        chainId,
        txHash,
        logIndex: boughtRef.logIndex,
        side: "buy",
        token: boughtToken.token,
        referenceToken: boughtRef.token,
        amountIn: boughtRef.amount,
        amountOut: boughtToken.amount,
        blockNumber: block,
      });
    } else if (soldRef !== undefined && soldToken !== undefined) {
      swaps.push({
        walletId: wallet.id,
        chainId,
        txHash,
        logIndex: soldRef.logIndex,
        side: "sell",
        token: soldToken.token,
        referenceToken: soldRef.token,
        amountIn: soldToken.amount,
        amountOut: soldRef.amount,
        blockNumber: block,
      });
    }
  }

  // Deterministic order: by block then by the representative log index.
  return swaps.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );
}
