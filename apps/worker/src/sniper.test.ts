import { BASE_WETH } from "@bot/dex-adapters";
import { toAddress, type Address, type Pool, type Token } from "@bot/domain";
import { createEvent, InMemoryEventBus } from "@bot/events";
import { InMemoryStrategyStore } from "@bot/strategies-core";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import { attachSniper, PoolRegistry } from "./sniper.js";

const CHAIN_ID = 8453;
const MEME = toAddress(getAddress("0x1111111111111111111111111111111111111111"));
const POOL_ADDR = toAddress(getAddress("0x2222222222222222222222222222222222222222"));

function token(address: Address): Token {
  return { chainId: CHAIN_ID, address, symbol: "MEME", name: "Meme", decimals: 18 };
}

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

function detected(tok: Token, withPool: boolean) {
  return createEvent(
    "token.detected",
    { token: tok, pool: withPool ? pool() : undefined },
    { source: "scanner" },
  );
}

describe("attachSniper", () => {
  let bus: InMemoryEventBus;
  let store: InMemoryStrategyStore;
  let registry: PoolRegistry;

  beforeEach(async () => {
    bus = new InMemoryEventBus();
    store = new InMemoryStrategyStore();
    registry = new PoolRegistry();
    await attachSniper({ bus, store, registry, quoteAmount: 1_000n, maxSlippageBps: 500 });
  });

  it("arms a one-shot snipe rule and records the pool for a detected token", async () => {
    await bus.publish(detected(token(MEME), true));

    const rules = await store.list();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      type: "snipe",
      token: MEME,
      simulated: true,
      status: "active",
      params: { kind: "snipe", quoteAmount: 1_000n, maxSlippageBps: 500 },
    });
    expect(registry.poolFor(MEME)?.address).toBe(POOL_ADDR);
  });

  it("is idempotent — a second detection of the same token does not add a rule", async () => {
    await bus.publish(detected(token(MEME), true));
    await bus.publish(detected(token(MEME), true));
    expect(await store.list()).toHaveLength(1);
  });

  it("skips WETH itself", async () => {
    await bus.publish(detected(token(BASE_WETH), true));
    expect(await store.list()).toHaveLength(0);
    expect(registry.poolFor(BASE_WETH)).toBeUndefined();
  });

  it("skips a detection with no pool to route against", async () => {
    await bus.publish(detected(token(MEME), false));
    expect(await store.list()).toHaveLength(0);
    expect(registry.poolFor(MEME)).toBeUndefined();
  });
});
