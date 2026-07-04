import { toAddress, type Address } from "@bot/domain";
import type { TransferLog } from "./decode";
import type { ObservedSwap, TrackedWallet } from "./rules";

export const WETH = toAddress("0x4200000000000000000000000000000000000006");
export const MEME = toAddress("0x9999999999999999999999999999999999999999");
export const LEADER = toAddress("0xabababababababababababababababababababab");
export const OTHER = toAddress("0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd");

export function wallet(overrides: Partial<TrackedWallet> = {}): TrackedWallet {
  return {
    id: "leader-1",
    chainId: 8453,
    address: LEADER,
    mode: "percent",
    sizeBps: 5_000,
    maxSlippageBps: 100,
    copySells: true,
    simulated: true,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export function swap(overrides: Partial<ObservedSwap> = {}): ObservedSwap {
  return {
    walletId: "leader-1",
    chainId: 8453,
    txHash: "0x" + "11".repeat(32),
    logIndex: 0,
    side: "buy",
    token: MEME,
    referenceToken: WETH,
    amountIn: 1_000n,
    amountOut: 500n,
    blockNumber: 100n,
    ...overrides,
  };
}

/** Build a synthetic ERC20 Transfer log for the decoder tests. */
export function transferLog(args: {
  token: Address;
  from: Address;
  to: Address;
  value: bigint;
  txHash?: string;
  logIndex?: number;
  blockNumber?: bigint;
}): TransferLog {
  return {
    address: args.token,
    transactionHash: args.txHash ?? "0x" + "aa".repeat(32),
    logIndex: args.logIndex ?? 0,
    blockNumber: args.blockNumber ?? 100n,
    args: { from: args.from, to: args.to, value: args.value },
  };
}
