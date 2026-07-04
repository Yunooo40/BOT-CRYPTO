import { decodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it, vi } from "vitest";
import { TradeRevertedError } from "./errors";
import { LiveExecutor, type ExecutorClient } from "./live-executor";
import type { Signer } from "./ports";
import { buyIntent, pool, ROUTER_ADDR, stubRouter, TRADER } from "./test-helpers";

function makeSigner(overrides: Partial<Signer> = {}): Signer {
  return {
    address: TRADER,
    sendTransaction: vi.fn(async () => `0x${"a".repeat(64)}` as `0x${string}`),
    waitForSuccess: vi.fn(async () => true),
    ...overrides,
  };
}

function makeClient(allowance: bigint): ExecutorClient {
  return { readContract: vi.fn(async () => allowance) } as unknown as ExecutorClient;
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
