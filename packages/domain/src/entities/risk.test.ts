import { describe, expect, it } from "vitest";
import { riskScoreSchema } from "./risk";

describe("riskScoreSchema", () => {
  it("accepts a well-formed score with factors", () => {
    const parsed = riskScoreSchema.parse({
      score: 82,
      verdict: "danger",
      factors: [{ detector: "honeypot", score: 100, weight: 0.5, detail: "sell disabled" }],
    });
    expect(parsed.verdict).toBe("danger");
    expect(parsed.factors).toHaveLength(1);
  });

  it("rejects an out-of-range aggregate score", () => {
    expect(() => riskScoreSchema.parse({ score: 150, verdict: "safe", factors: [] })).toThrow();
  });

  it("rejects an unknown verdict", () => {
    expect(() => riskScoreSchema.parse({ score: 10, verdict: "unknown", factors: [] })).toThrow();
  });
});
