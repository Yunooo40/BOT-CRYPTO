import { ValidationError } from "@bot/errors";
import { describe, expect, it } from "vitest";
import { formatTokenAmount, parseTokenAmount, tokenAmount, tokenAmountSchema } from "./amount";

describe("token amount", () => {
  it("round-trips parse and format", () => {
    const amount = parseTokenAmount("1.5", 18);
    expect(amount.raw).toBe(1_500_000_000_000_000_000n);
    expect(formatTokenAmount(amount)).toBe("1.5");
  });

  it("formats whole numbers without a decimal point", () => {
    expect(formatTokenAmount(tokenAmount(1_000_000n, 6))).toBe("1");
  });

  it("formats zero", () => {
    expect(formatTokenAmount(tokenAmount(0n, 18))).toBe("0");
  });

  it("rejects negative raw amounts", () => {
    expect(() => tokenAmount(-1n, 18)).toThrow(ValidationError);
  });

  it("rejects more fractional digits than the scale allows", () => {
    expect(() => parseTokenAmount("1.1234567", 6)).toThrow(ValidationError);
  });

  it("coerces a wire string back into a bigint via the schema", () => {
    const parsed = tokenAmountSchema.parse({ raw: "2500000", decimals: 6 });
    expect(parsed.raw).toBe(2_500_000n);
    expect(typeof parsed.raw).toBe("bigint");
  });
});
