import { describe, expect, it } from "vitest";
import { defaultCopyPolicy } from "./policy";
import { MEME, OTHER, swap, wallet } from "./test-helpers";

const evalPolicy = defaultCopyPolicy.evaluate.bind(defaultCopyPolicy);

describe("defaultCopyPolicy — buys", () => {
  it("sizes a percent buy from the leader's spend", () => {
    const action = evalPolicy({
      wallet: wallet({ mode: "percent", sizeBps: 2_500 }),
      swap: swap({ side: "buy", amountIn: 1_000n }),
      heldAmount: 0n,
      now: 0,
    });
    expect(action.kind).toBe("emit");
    if (action.kind === "emit") expect(action.intent.amountIn.raw).toBe(250n);
  });

  it("uses a fixed amount in fixed mode", () => {
    const action = evalPolicy({
      wallet: wallet({ mode: "fixed", fixedAmountIn: 777n }),
      swap: swap({ side: "buy", amountIn: 1_000n }),
      heldAmount: 0n,
      now: 0,
    });
    if (action.kind === "emit") expect(action.intent.amountIn.raw).toBe(777n);
    else throw new Error("expected emit");
  });

  it("clamps a buy to maxAmountIn", () => {
    const action = evalPolicy({
      wallet: wallet({ mode: "percent", sizeBps: 10_000, maxAmountIn: 400n }),
      swap: swap({ side: "buy", amountIn: 1_000n }),
      heldAmount: 0n,
      now: 0,
    });
    if (action.kind === "emit") expect(action.intent.amountIn.raw).toBe(400n);
    else throw new Error("expected emit");
  });

  it("skips a buy below minAmountIn", () => {
    const action = evalPolicy({
      wallet: wallet({ mode: "percent", sizeBps: 100, minAmountIn: 500n }),
      swap: swap({ side: "buy", amountIn: 1_000n }),
      heldAmount: 0n,
      now: 0,
    });
    expect(action).toEqual({ kind: "skip", reason: "sized buy amount below minimum" });
  });

  it("skips a token on the deny-list", () => {
    const action = evalPolicy({
      wallet: wallet({ denyTokens: [MEME] }),
      swap: swap({ side: "buy", token: MEME }),
      heldAmount: 0n,
      now: 0,
    });
    expect(action).toEqual({ kind: "skip", reason: "token on deny-list" });
  });

  it("skips a token absent from a non-empty allow-list", () => {
    const action = evalPolicy({
      wallet: wallet({ allowTokens: [OTHER] }),
      swap: swap({ side: "buy", token: MEME }),
      heldAmount: 0n,
      now: 0,
    });
    expect(action).toEqual({ kind: "skip", reason: "token not on allow-list" });
  });
});

describe("defaultCopyPolicy — sells", () => {
  it("mirrors a sell as a fraction of our held position", () => {
    const action = evalPolicy({
      wallet: wallet({ mode: "percent", sizeBps: 5_000, copySells: true }),
      swap: swap({ side: "sell" }),
      heldAmount: 800n,
      now: 0,
    });
    if (action.kind === "emit") {
      expect(action.intent.side).toBe("sell");
      expect(action.intent.amountIn.raw).toBe(400n);
    } else throw new Error("expected emit");
  });

  it("sells the whole position in fixed mode", () => {
    const action = evalPolicy({
      wallet: wallet({ mode: "fixed", copySells: true }),
      swap: swap({ side: "sell" }),
      heldAmount: 800n,
      now: 0,
    });
    if (action.kind === "emit") expect(action.intent.amountIn.raw).toBe(800n);
    else throw new Error("expected emit");
  });

  it("skips when sell copying is disabled", () => {
    const action = evalPolicy({
      wallet: wallet({ copySells: false }),
      swap: swap({ side: "sell" }),
      heldAmount: 800n,
      now: 0,
    });
    expect(action).toEqual({ kind: "skip", reason: "sell copying disabled" });
  });

  it("skips a sell when flat", () => {
    const action = evalPolicy({
      wallet: wallet({ copySells: true }),
      swap: swap({ side: "sell" }),
      heldAmount: 0n,
      now: 0,
    });
    expect(action).toEqual({ kind: "skip", reason: "no position to mirror the sell" });
  });
});
