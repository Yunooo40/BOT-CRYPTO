import { toAddress, type Token } from "@bot/domain";
import { createEvent, InMemoryEventBus, type DomainEvent } from "@bot/events";
import { createLogger } from "@bot/logger";
import { describe, expect, it, vi } from "vitest";
import { ShieldAnalyzer } from "./analyzer";
import { attachShield } from "./bus";
import type { Detector } from "./detector";

const silent = createLogger({ destination: { write: () => {} } });
const TOKEN = toAddress("0x9999999999999999999999999999999999999999");
const WETH = toAddress("0x4200000000000000000000000000000000000006");

const token: Token = {
  chainId: 8453,
  address: TOKEN,
  symbol: "MEME",
  name: "Meme",
  decimals: 18,
};

describe("attachShield", () => {
  it("assesses token.detected and publishes a correlated risk.assessed", async () => {
    const bus = new InMemoryEventBus({ logger: silent });
    const risks: DomainEvent[] = [];
    await bus.subscribe("risk.assessed", (event) => void risks.push(event), { group: "test" });

    const detector: Detector = {
      name: "stub",
      weight: 1,
      fast: true,
      detect: vi.fn(async () => ({ score: 12, detail: "ok" })),
    };
    const analyzer = new ShieldAnalyzer({
      client: {
        getCode: vi.fn().mockResolvedValue("0x6080"),
        readContract: vi.fn(),
        getStorageAt: vi.fn(),
      } as never,
      detectors: [detector],
      logger: silent,
    });
    await attachShield({ bus, analyzer, logger: silent });

    const detected = createEvent(
      "token.detected",
      {
        token,
        pool: {
          chainId: 8453,
          address: toAddress("0x1111111111111111111111111111111111111111"),
          dex: "uniswap-v2",
          token0: WETH,
          token1: TOKEN,
        },
      },
      { source: "scanner" },
    );
    await bus.publish(detected);

    expect(risks).toHaveLength(1);
    const assessed = risks[0];
    expect(assessed?.type).toBe("risk.assessed");
    expect(assessed?.correlationId).toBe(detected.correlationId);
    expect(assessed?.source).toBe("shield");
    expect(assessed?.payload).toMatchObject({
      token: TOKEN,
      chainId: 8453,
      risk: { score: 12, verdict: "safe" },
    });
    // The non-token side of the pair was passed as the quote token.
    expect((detector.detect as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      quoteToken: WETH,
    });
  });

  it("uses the quick gate when mode is 'quick'", async () => {
    const bus = new InMemoryEventBus({ logger: silent });
    const fast: Detector = {
      name: "fast",
      weight: 1,
      fast: true,
      detect: vi.fn(async () => ({ score: 5, detail: "" })),
    };
    const slow: Detector = {
      name: "slow",
      weight: 1,
      fast: false,
      detect: vi.fn(async () => ({ score: 90, detail: "" })),
    };
    const analyzer = new ShieldAnalyzer({
      client: {
        getCode: vi.fn().mockResolvedValue("0x6080"),
        readContract: vi.fn(),
        getStorageAt: vi.fn(),
      } as never,
      detectors: [fast, slow],
      logger: silent,
    });
    await attachShield({ bus, analyzer, logger: silent, mode: "quick" });
    await bus.publish(createEvent("token.detected", { token }, { source: "scanner" }));
    expect(slow.detect).not.toHaveBeenCalled();
    expect(fast.detect).toHaveBeenCalledTimes(1);
  });
});
