import { describe, expect, it } from "vitest";
import { PaperExecutor } from "./paper-executor";
import { buyIntent, pool, stubRouter } from "./test-helpers";

describe("PaperExecutor", () => {
  it("settles against the real quote, no transaction, simulated flag set", async () => {
    const { router, adapter } = stubRouter(2_000n * 10n ** 6n);
    const executor = new PaperExecutor({ router });
    const trade = await executor.execute({ intent: buyIntent(), pool, intentId: "intent-1" });
    expect(executor.mode).toBe("paper");
    expect(trade.simulated).toBe(true);
    expect(trade.amountOut.raw).toBe(2_000n * 10n ** 6n);
    expect(trade.txHash).toMatch(/^0x7061706572/); // "0xpaper…"
    expect(trade.id).toBe("intent-1");
    // A real quote was taken — paper is not a pure mock, it reads the chain.
    expect(adapter.quoteExactIn).toHaveBeenCalledOnce();
    expect(adapter.buildSwapCalldata).not.toHaveBeenCalled();
  });

  it("produces a deterministic hash per intent id", async () => {
    const { router } = stubRouter(1n);
    const executor = new PaperExecutor({ router });
    const a = await executor.execute({ intent: buyIntent(), pool, intentId: "same" });
    const b = await executor.execute({ intent: buyIntent(), pool, intentId: "same" });
    expect(a.txHash).toBe(b.txHash);
    expect(a.txHash).toHaveLength(66);
  });
});
