import { BASE_WETH } from "@bot/dex-adapters";
import { toAddress, tokenAmount, type Address, type Pool, type Trade } from "@bot/domain";
import { createEvent, InMemoryEventBus } from "@bot/events";
import { PRICE_SCALE, InMemoryStrategyStore } from "@bot/strategies-core";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import { attachExitArmer, buildExitRules, entryPriceOf, type ExitConfig } from "./exits.js";
import { PoolRegistry } from "./sniper.js";

const CHAIN_ID = 8453;
const MEME = toAddress(getAddress("0x1111111111111111111111111111111111111111"));
const POOL_ADDR = toAddress(getAddress("0x2222222222222222222222222222222222222222"));
const TX_HASH = `0x${"33".repeat(32)}` as const;

const CONFIG: ExitConfig = {
  gainBps: 5_000,
  lossBps: 3_000,
  sellFractionBps: 10_000,
  maxSlippageBps: 500,
  trailingBps: 0, // fixed stop-loss
};

const TRAILING_CONFIG: ExitConfig = { ...CONFIG, trailingBps: 2_000 };

function pool(): Pool {
  return {
    chainId: CHAIN_ID,
    address: POOL_ADDR,
    dex: "uniswap-v3",
    token0: BASE_WETH,
    token1: MEME,
    feeTier: 3000,
  };
}

function fill(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "intent-1",
    chainId: CHAIN_ID,
    side: "buy",
    token: MEME,
    amountIn: tokenAmount(2n * PRICE_SCALE, 18), // 2 WETH quote
    amountOut: tokenAmount(PRICE_SCALE, 18), // 1 token
    txHash: TX_HASH,
    simulated: true,
    ...overrides,
  };
}

function executed(trade: Trade) {
  return createEvent("trade.executed", { trade }, { source: "engine" });
}

describe("entryPriceOf", () => {
  it("prices a fill buy-side: amountIn·SCALE / amountOut", () => {
    // 2 WETH for 1 token → 2·SCALE per token.
    expect(entryPriceOf(fill())).toBe(2n * PRICE_SCALE);
  });

  it("is undefined for an unpriceable fill (zero out)", () => {
    expect(entryPriceOf(fill({ amountOut: tokenAmount(0n, 18) }))).toBeUndefined();
  });
});

describe("buildExitRules", () => {
  it("arms a take-profit and a stop-loss sharing the fill's entry price, book and wallet", () => {
    const rules = buildExitRules(fill(), pool(), "wallet-1", CONFIG, 1_000);
    expect(rules).toHaveLength(2);

    const [tp, sl] = rules;
    expect(tp).toMatchObject({
      id: `tp:${MEME}`,
      type: "take-profit",
      walletId: "wallet-1",
      simulated: true,
      status: "active",
      params: {
        kind: "take-profit",
        entryPrice: 2n * PRICE_SCALE,
        gainBps: 5_000,
        sellFractionBps: 10_000,
      },
    });
    expect(sl).toMatchObject({
      id: `sl:${MEME}`,
      type: "stop-loss",
      params: { kind: "stop-loss", entryPrice: 2n * PRICE_SCALE, lossBps: 3_000 },
    });
  });

  it("arms a trailing stop instead of the fixed stop-loss when trailingBps > 0", () => {
    const rules = buildExitRules(fill(), pool(), "wallet-1", TRAILING_CONFIG, 1_000);
    expect(rules).toHaveLength(2);

    const [tp, stop] = rules;
    expect(tp?.type).toBe("take-profit"); // TP unchanged
    expect(stop).toMatchObject({
      id: `trail:${MEME}`,
      type: "trailing-stop",
      params: { kind: "trailing-stop", trailingBps: 2_000, sellFractionBps: 10_000 },
    });
    // Mutually exclusive: no fixed stop-loss alongside the trailing one.
    expect(rules.some((r) => r.type === "stop-loss")).toBe(false);
  });

  it("arms nothing for an unpriceable fill", () => {
    expect(
      buildExitRules(fill({ amountOut: tokenAmount(0n, 18) }), pool(), "w", CONFIG, 0),
    ).toHaveLength(0);
  });
});

describe("attachExitArmer", () => {
  let bus: InMemoryEventBus;
  let store: InMemoryStrategyStore;
  let registry: PoolRegistry;

  beforeEach(async () => {
    bus = new InMemoryEventBus();
    store = new InMemoryStrategyStore();
    registry = new PoolRegistry();
    registry.record(MEME, pool());
    await attachExitArmer({ bus, store, registry, walletId: "wallet-1", config: CONFIG });
  });

  it("arms TP + SL when a buy executes", async () => {
    await bus.publish(executed(fill()));
    const rules = await store.list();
    expect(rules.map((r) => r.type).sort()).toEqual(["stop-loss", "take-profit"]);
  });

  it("ignores sells — only entries open a position to protect", async () => {
    await bus.publish(executed(fill({ side: "sell" })));
    expect(await store.list()).toHaveLength(0);
  });

  it("skips a token with no known pool to route the exit through", async () => {
    const other = toAddress(getAddress("0x4444444444444444444444444444444444444444"));
    await bus.publish(executed(fill({ token: other as Address })));
    expect(await store.list()).toHaveLength(0);
  });

  it("re-arming the same token overwrites rather than duplicating exits", async () => {
    await bus.publish(executed(fill()));
    await bus.publish(executed(fill()));
    expect(await store.list()).toHaveLength(2);
  });

  it("arms TP + trailing-stop when configured for trailing", async () => {
    const trailingBus = new InMemoryEventBus();
    const trailingStore = new InMemoryStrategyStore();
    const trailingRegistry = new PoolRegistry();
    trailingRegistry.record(MEME, pool());
    await attachExitArmer({
      bus: trailingBus,
      store: trailingStore,
      registry: trailingRegistry,
      walletId: "wallet-1",
      config: TRAILING_CONFIG,
    });

    await trailingBus.publish(executed(fill()));
    const rules = await trailingStore.list();
    expect(rules.map((r) => r.type).sort()).toEqual(["take-profit", "trailing-stop"]);
  });
});
