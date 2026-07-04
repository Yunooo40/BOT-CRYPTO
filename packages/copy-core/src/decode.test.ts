import { describe, expect, it } from "vitest";
import { decodeSwaps } from "./decode";
import { LEADER, MEME, OTHER, WETH, transferLog, wallet } from "./test-helpers";

const TX = "0x" + "22".repeat(32);
const w = wallet();

describe("decodeSwaps", () => {
  it("decodes a buy (reference out, token in)", () => {
    const logs = [
      transferLog({ token: WETH, from: LEADER, to: OTHER, value: 1_000n, txHash: TX, logIndex: 1 }),
      transferLog({ token: MEME, from: OTHER, to: LEADER, value: 4_200n, txHash: TX, logIndex: 2 }),
    ];
    const [s] = decodeSwaps(logs, w, [WETH], 8453);
    expect(s?.side).toBe("buy");
    expect(s?.token).toBe(MEME);
    expect(s?.amountIn).toBe(1_000n);
    expect(s?.amountOut).toBe(4_200n);
    expect(s?.logIndex).toBe(1);
  });

  it("decodes a sell (token out, reference in)", () => {
    const logs = [
      transferLog({ token: MEME, from: LEADER, to: OTHER, value: 4_200n, txHash: TX, logIndex: 3 }),
      transferLog({ token: WETH, from: OTHER, to: LEADER, value: 900n, txHash: TX, logIndex: 4 }),
    ];
    const [s] = decodeSwaps(logs, w, [WETH], 8453);
    expect(s?.side).toBe("sell");
    expect(s?.token).toBe(MEME);
    expect(s?.amountIn).toBe(4_200n);
    expect(s?.amountOut).toBe(900n);
  });

  it("skips token-to-token swaps (no reference leg)", () => {
    const logs = [
      transferLog({ token: MEME, from: LEADER, to: OTHER, value: 5n, txHash: TX, logIndex: 1 }),
      transferLog({ token: OTHER, from: OTHER, to: LEADER, value: 7n, txHash: TX, logIndex: 2 }),
    ];
    expect(decodeSwaps(logs, w, [WETH], 8453)).toHaveLength(0);
  });

  it("ignores transfers that do not touch the wallet", () => {
    const logs = [
      transferLog({ token: WETH, from: OTHER, to: OTHER, value: 1n, txHash: TX, logIndex: 1 }),
      transferLog({ token: MEME, from: OTHER, to: OTHER, value: 1n, txHash: TX, logIndex: 2 }),
    ];
    expect(decodeSwaps(logs, w, [WETH], 8453)).toHaveLength(0);
  });

  it("picks the largest token leg when several move", () => {
    const big = OTHER;
    const logs = [
      transferLog({ token: WETH, from: LEADER, to: OTHER, value: 1_000n, txHash: TX, logIndex: 1 }),
      transferLog({ token: MEME, from: OTHER, to: LEADER, value: 10n, txHash: TX, logIndex: 2 }),
      transferLog({ token: big, from: OTHER, to: LEADER, value: 999n, txHash: TX, logIndex: 3 }),
    ];
    const [s] = decodeSwaps(logs, w, [WETH], 8453);
    expect(s?.token).toBe(big);
    expect(s?.amountOut).toBe(999n);
  });

  it("separates swaps across transactions and orders them", () => {
    const tx1 = "0x" + "01".repeat(32);
    const tx2 = "0x" + "02".repeat(32);
    const logs = [
      transferLog({ token: WETH, from: LEADER, to: OTHER, value: 1n, txHash: tx2, logIndex: 0, blockNumber: 200n }),
      transferLog({ token: MEME, from: OTHER, to: LEADER, value: 2n, txHash: tx2, logIndex: 1, blockNumber: 200n }),
      transferLog({ token: WETH, from: LEADER, to: OTHER, value: 3n, txHash: tx1, logIndex: 0, blockNumber: 100n }),
      transferLog({ token: MEME, from: OTHER, to: LEADER, value: 4n, txHash: tx1, logIndex: 1, blockNumber: 100n }),
    ];
    const swaps = decodeSwaps(logs, w, [WETH], 8453);
    expect(swaps.map((s) => s.blockNumber)).toEqual([100n, 200n]);
  });
});
