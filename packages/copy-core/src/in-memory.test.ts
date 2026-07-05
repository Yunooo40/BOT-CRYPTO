import { ValidationError } from "@bot/errors";
import { toAddress } from "@bot/domain";
import { describe, expect, it } from "vitest";
import { InMemoryCopyStore } from "./in-memory";
import { MAX_TRACKED_WALLETS } from "./rules";
import { wallet } from "./test-helpers";

function addr(i: number): ReturnType<typeof toAddress> {
  return toAddress("0x" + i.toString(16).padStart(40, "0"));
}

describe("InMemoryCopyStore", () => {
  it("lists only enabled wallets", async () => {
    const store = new InMemoryCopyStore();
    await store.upsertWallet(wallet({ id: "on", enabled: true, address: addr(1) }));
    await store.upsertWallet(wallet({ id: "off", enabled: false, address: addr(2) }));
    const active = await store.listActiveWallets();
    expect(active.map((w) => w.id)).toEqual(["on"]);
  });

  it("round-trips cursors and copied markers", async () => {
    const store = new InMemoryCopyStore();
    await store.setCursor("w", 4_242n);
    expect(await store.getCursor("w")).toBe(4_242n);
    expect(await store.hasCopied("w", "0xabc", 1)).toBe(false);
    await store.markCopied("w", "0xabc", 1);
    expect(await store.hasCopied("w", "0xabc", 1)).toBe(true);
    expect(await store.hasCopied("w", "0xabc", 2)).toBe(false);
  });

  it("enforces the follow cap of MAX_TRACKED_WALLETS", async () => {
    const store = new InMemoryCopyStore();
    for (let i = 0; i < MAX_TRACKED_WALLETS; i++) {
      await store.upsertWallet(wallet({ id: `w${i}`, enabled: true, address: addr(i + 1) }));
    }
    await expect(
      store.upsertWallet(wallet({ id: "one-too-many", enabled: true, address: addr(9_999) })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows updating an already-followed wallet at the cap", async () => {
    const store = new InMemoryCopyStore();
    for (let i = 0; i < MAX_TRACKED_WALLETS; i++) {
      await store.upsertWallet(wallet({ id: `w${i}`, enabled: true, address: addr(i + 1) }));
    }
    await expect(
      store.upsertWallet(wallet({ id: "w0", enabled: true, address: addr(1), label: "renamed" })),
    ).resolves.toBeUndefined();
  });
});
