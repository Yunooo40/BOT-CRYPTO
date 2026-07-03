import { describe, expect, it } from "vitest";
import { ManagedEndpoint } from "./endpoint";

function makeEndpoint(overrides: Partial<ConstructorParameters<typeof ManagedEndpoint>[0]> = {}) {
  return new ManagedEndpoint({
    config: { url: "https://a.example", weight: 1 },
    failureThreshold: 3,
    cooldownMs: 10_000,
    maxCooldownMs: 40_000,
    ...overrides,
  });
}

describe("ManagedEndpoint", () => {
  it("stays healthy below the failure threshold", () => {
    const endpoint = makeEndpoint();
    expect(endpoint.recordFailure(0)).toEqual({ wentDown: false });
    expect(endpoint.recordFailure(0)).toEqual({ wentDown: false });
    expect(endpoint.status).toBe("healthy");
    expect(endpoint.isSelectable(0)).toBe(true);
    expect(endpoint.health().consecutiveFailures).toBe(2);
  });

  it("goes down at the threshold and cools off", () => {
    const endpoint = makeEndpoint();
    endpoint.recordFailure(0);
    endpoint.recordFailure(0);
    expect(endpoint.recordFailure(0)).toEqual({ wentDown: true });
    expect(endpoint.status).toBe("down");
    expect(endpoint.isSelectable(9_999)).toBe(false);
    expect(endpoint.isSelectable(10_000)).toBe(true);
    expect(endpoint.health().retryAt).toBe(10_000);
  });

  it("doubles the cool-down on each failed probe, up to the ceiling", () => {
    const endpoint = makeEndpoint();
    endpoint.recordFailure(0);
    endpoint.recordFailure(0);
    endpoint.recordFailure(0); // down, retryAt = 10 000
    endpoint.recordFailure(10_000); // probe fails: cooldown 20 000
    expect(endpoint.health().retryAt).toBe(30_000);
    endpoint.recordFailure(30_000); // cooldown 40 000 (ceiling)
    expect(endpoint.health().retryAt).toBe(70_000);
    endpoint.recordFailure(70_000); // capped at 40 000
    expect(endpoint.health().retryAt).toBe(110_000);
  });

  it("recovers on success and resets failures and cool-down", () => {
    const endpoint = makeEndpoint({ failureThreshold: 1 });
    endpoint.recordFailure(0);
    endpoint.recordFailure(10_000); // failed probe: cooldown now 20 000
    expect(endpoint.status).toBe("down");
    expect(endpoint.recordSuccess()).toEqual({ recovered: true });
    expect(endpoint.status).toBe("healthy");
    expect(endpoint.health().consecutiveFailures).toBe(0);
    // Cool-down is back to base: the next trip cools 10 000, not 20 000.
    endpoint.recordFailure(50_000);
    expect(endpoint.health().retryAt).toBe(60_000);
  });

  it("does not report a recovery when already healthy", () => {
    const endpoint = makeEndpoint();
    expect(endpoint.recordSuccess()).toEqual({ recovered: false });
  });
});
