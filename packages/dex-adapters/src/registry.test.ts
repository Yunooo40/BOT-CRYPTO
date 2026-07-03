import { describe, expect, it, vi } from "vitest";
import type { ChainReader } from "./adapter";
import { createDexAdapters } from "./registry";

describe("createDexAdapters", () => {
  it("builds one adapter per venue, keyed by its dex", () => {
    const client = { readContract: vi.fn() } as unknown as ChainReader;
    const adapters = createDexAdapters(client);
    expect([...adapters.keys()].sort()).toEqual(["aerodrome", "uniswap-v2", "uniswap-v3"]);
    for (const [dex, adapter] of adapters) {
      expect(adapter.dex).toBe(dex);
    }
  });
});
