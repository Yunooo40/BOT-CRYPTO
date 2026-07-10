import { asHex } from "@bot/dex-adapters";
import type { Address } from "@bot/domain";
import { decodeFunctionData, erc20Abi, type Hex, type TransactionReceipt } from "viem";
import { describe, expect, it, vi } from "vitest";
import { TradeRevertedError } from "./errors";
import { LiveExecutor, type ExecutorClient } from "./live-executor";
import type { Signer } from "./ports";
import { buyIntent, MEME, pool, ROUTER_ADDR, stubRouter, TRADER } from "./test-helpers";

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

/** Left-pad an address/number to a 32-byte topic/word. */
function word(hex: string): Hex {
  return `0x${hex.replace(/^0x/, "").toLowerCase().padStart(64, "0")}` as Hex;
}

function makeSigner(overrides: Partial<Signer> = {}): Signer {
  return {
    address: TRADER,
    sendTransaction: vi.fn(async () => `0x${"a".repeat(64)}` as `0x${string}`),
    waitForSuccess: vi.fn(async () => true),
    ...overrides,
  };
}

/** An ERC-20 Transfer log of `value` `token` base units into `to`. */
function transferLog(token: Address, to: Address, value: bigint) {
  return {
    address: asHex(token),
    topics: [TRANSFER_TOPIC, word(asHex(ROUTER_ADDR)), word(asHex(to))],
    data: word(value.toString(16)),
  };
}

function makeClient(allowance: bigint, logs: unknown[] = []): ExecutorClient {
  return {
    readContract: vi.fn(async () => allowance),
    getTransactionReceipt: vi.fn(async () => ({ logs }) as unknown as TransactionReceipt),
  } as unknown as ExecutorClient;
}

describe("LiveExecutor", () => {
  it("approves then swaps when the allowance is insufficient", async () => {
    const { router } = stubRouter(2_000n);
    const signer = makeSigner();
    const executor = new LiveExecutor({ router, signer, client: makeClient(0n) });

    const trade = await executor.execute({ intent: buyIntent(), pool, intentId: "live-1" });

    const send = signer.sendTransaction as ReturnType<typeof vi.fn>;
    expect(send).toHaveBeenCalledTimes(2); // approve + swap
    const approve = decodeFunctionData({ abi: erc20Abi, data: send.mock.calls[0]?.[0].data });
    expect(approve.functionName).toBe("approve");
    expect(send.mock.calls[1]?.[0]).toMatchObject({ to: ROUTER_ADDR, value: 0n });
    expect(trade.simulated).toBe(false);
    expect(trade.txHash).toBe(`0x${"a".repeat(64)}`);
  });

  it("skips the approve when the allowance already covers the amount", async () => {
    const { router } = stubRouter(2_000n);
    const signer = makeSigner();
    const executor = new LiveExecutor({ router, signer, client: makeClient(10n ** 30n) });
    await executor.execute({ intent: buyIntent(), pool, intentId: "live-2" });
    expect(signer.sendTransaction).toHaveBeenCalledOnce(); // swap only
  });

  it("records the amount actually received (net of tax), not the router's minOut", async () => {
    const { router } = stubRouter(2_000n); // quote 2000, minOut @1% = 1980
    const signer = makeSigner();
    // Wallet nets 1950 — below the slippage floor, but the swap still mined
    // (fee-on-transfer). The fill must reflect what truly landed, not 1980/2000.
    const client = makeClient(10n ** 30n, [transferLog(MEME, TRADER, 1950n)]);
    const executor = new LiveExecutor({ router, signer, client });

    const trade = await executor.execute({ intent: buyIntent(), pool, intentId: "live-net" });

    expect(trade.amountOut.raw).toBe(1950n);
  });

  it("falls back to the slippage floor when no Transfer to the wallet is in the receipt", async () => {
    const { router } = stubRouter(2_000n);
    const signer = makeSigner();
    const executor = new LiveExecutor({ router, signer, client: makeClient(10n ** 30n) });

    const trade = await executor.execute({ intent: buyIntent(), pool, intentId: "live-fallback" });

    expect(trade.amountOut.raw).toBe(1980n); // minOut @1% of 2000
  });

  it("throws a non-retryable TradeRevertedError when the swap receipt fails", async () => {
    const { router } = stubRouter(2_000n);
    const signer = makeSigner({ waitForSuccess: vi.fn(async () => false) });
    const executor = new LiveExecutor({ router, signer, client: makeClient(10n ** 30n) });
    await expect(
      executor.execute({ intent: buyIntent(), pool, intentId: "live-3" }),
    ).rejects.toThrow(TradeRevertedError);
  });

  it("aborts if the approve transaction reverts", async () => {
    const { router } = stubRouter(2_000n);
    const signer = makeSigner({ waitForSuccess: vi.fn(async () => false) });
    const executor = new LiveExecutor({ router, signer, client: makeClient(0n) });
    await expect(
      executor.execute({ intent: buyIntent(), pool, intentId: "live-4" }),
    ).rejects.toThrow(TradeRevertedError);
    // Failed on the approve receipt — the swap was never sent.
    expect(signer.sendTransaction).toHaveBeenCalledOnce();
  });
});
