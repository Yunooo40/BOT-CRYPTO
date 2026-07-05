import { describe, expect, it } from "vitest";
import { InMemoryRateLimitStore } from "./in-memory-store";

const WINDOW = 60_000;

describe("InMemoryRateLimitStore", () => {
  it("allows up to the limit inside one window", async () => {
    const store = new InMemoryRateLimitStore();
    const t0 = 1_000_000;
    await expect(store.hit("k", 2, WINDOW, t0)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(store.hit("k", 2, WINDOW, t0 + 1)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    await expect(store.hit("k", 2, WINDOW, t0 + 2)).resolves.toMatchObject({ allowed: false });
  });

  it("slides: a hit re-enters the budget exactly when the oldest ages out", async () => {
    const store = new InMemoryRateLimitStore();
    const t0 = 1_000_000;
    await store.hit("k", 1, WINDOW, t0);
    const denied = await store.hit("k", 1, WINDOW, t0 + 30_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(30_000);
    await expect(store.hit("k", 1, WINDOW, t0 + WINDOW + 1)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("denied hits do not consume budget", async () => {
    const store = new InMemoryRateLimitStore();
    const t0 = 1_000_000;
    await store.hit("k", 1, WINDOW, t0);
    for (let i = 1; i <= 10; i += 1) {
      await store.hit("k", 1, WINDOW, t0 + i);
    }
    // The only counted hit is t0; once it ages out, the key is clean again.
    await expect(store.hit("k", 1, WINDOW, t0 + WINDOW + 1)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("isolates keys", async () => {
    const store = new InMemoryRateLimitStore();
    await store.hit("a", 1, WINDOW, 0);
    await expect(store.hit("b", 1, WINDOW, 1)).resolves.toMatchObject({ allowed: true });
  });
});
