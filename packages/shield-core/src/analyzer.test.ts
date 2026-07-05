import { toAddress, type RiskFactor } from "@bot/domain";
import { createLogger } from "@bot/logger";
import { describe, expect, it, vi } from "vitest";
import { aggregate, ShieldAnalyzer } from "./analyzer";
import { INDETERMINATE_SCORE, type Detector } from "./detector";

const silent = createLogger({ destination: { write: () => {} } });
const TOKEN = toAddress("0x9999999999999999999999999999999999999999");
const WETH = toAddress("0x4200000000000000000000000000000000000006");

function factor(score: number, weight: number): RiskFactor {
  return { detector: "x", weight, score, detail: "" };
}

const detector = (
  name: string,
  score: number,
  fast: boolean,
  opts: Partial<Detector> = {},
): Detector => ({
  name,
  weight: 1,
  fast,
  detect: vi.fn(async () => ({ score, detail: `${name}=${score}` })),
  ...opts,
});

describe("aggregate", () => {
  it("computes a weighted average", () => {
    expect(aggregate([factor(0, 0.5), factor(100, 0.5)])).toBe(50);
    expect(aggregate([factor(0, 0.75), factor(100, 0.25)])).toBe(25);
  });

  it("normalizes by the weights actually present", () => {
    // A subset (the fast gate) still yields a 0–100 score, not a deflated one.
    expect(aggregate([factor(80, 0.1)])).toBe(80);
  });

  it("returns 0 for no factors", () => {
    expect(aggregate([])).toBe(0);
  });
});

function analyzer(detectors: Detector[], overrides = {}) {
  const client = {
    getCode: vi.fn().mockResolvedValue("0x6080"),
    readContract: vi.fn(),
    getStorageAt: vi.fn(),
  };
  return new ShieldAnalyzer({ client: client as never, detectors, logger: silent, ...overrides });
}

describe("ShieldAnalyzer", () => {
  it("assess runs every detector and derives the verdict", async () => {
    const shield = analyzer([
      detector("a", 10, true),
      detector("b", 20, false),
      detector("c", 0, false),
    ]);
    const risk = await shield.assess({ token: TOKEN, quoteToken: WETH });
    expect(risk.factors).toHaveLength(3);
    expect(risk.score).toBe(10);
    expect(risk.verdict).toBe("safe");
  });

  it("produces a danger verdict for high scores", async () => {
    const shield = analyzer([detector("a", 90, true), detector("b", 80, false)]);
    const risk = await shield.assess({ token: TOKEN, quoteToken: WETH });
    expect(risk.verdict).toBe("danger");
  });

  it("assessQuick runs only fast detectors", async () => {
    const fast = detector("fast", 10, true);
    const slow = detector("slow", 90, false);
    const shield = analyzer([fast, slow]);
    const risk = await shield.assessQuick({ token: TOKEN, quoteToken: WETH });
    expect(risk.factors.map((f) => f.detector)).toEqual(["fast"]);
    expect(slow.detect).not.toHaveBeenCalled();
  });

  it("caches quick assessments by token within the TTL", async () => {
    const fast = detector("fast", 10, true);
    let clock = 0;
    const shield = analyzer([fast], { now: () => clock, cacheTtlMs: 1_000 });
    await shield.assessQuick({ token: TOKEN, quoteToken: WETH });
    await shield.assessQuick({ token: TOKEN, quoteToken: WETH });
    expect(fast.detect).toHaveBeenCalledTimes(1);
    clock = 1_001;
    await shield.assessQuick({ token: TOKEN, quoteToken: WETH });
    expect(fast.detect).toHaveBeenCalledTimes(2);
  });

  it("turns a throwing detector into an indeterminate factor, not a crash", async () => {
    const boom = detector("boom", 0, false, {
      detect: vi.fn(async () => {
        throw new Error("rpc exploded");
      }),
    });
    const shield = analyzer([boom]);
    const risk = await shield.assess({ token: TOKEN, quoteToken: WETH });
    expect(risk.factors[0]).toMatchObject({ detector: "boom", score: INDETERMINATE_SCORE });
    expect(risk.factors[0]?.detail).toMatch(/indeterminate/);
  });

  it("turns a hanging detector into an indeterminate factor via timeout", async () => {
    const hang = detector("hang", 0, false, {
      detect: vi.fn((): Promise<{ score: number; detail: string }> => new Promise(() => {})),
    });
    const shield = analyzer([hang], { detectorTimeoutMs: 20 });
    const risk = await shield.assess({ token: TOKEN, quoteToken: WETH });
    expect(risk.factors[0]).toMatchObject({ score: INDETERMINATE_SCORE });
    expect(risk.factors[0]?.detail).toMatch(/timed out/);
  });
});
