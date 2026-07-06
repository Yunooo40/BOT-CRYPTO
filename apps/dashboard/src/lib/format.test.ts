import { describe, expect, it } from "vitest";
import { formatPct, formatTokenAmount, formatWeth, formatWinRate, shortenAddress } from "./format";

describe("formatTokenAmount", () => {
  it("renders a whole amount with no fractional part", () => {
    expect(formatTokenAmount("1000000000000000000", 18)).toBe("1");
  });

  it("renders a fractional amount, trimming trailing zeros", () => {
    expect(formatTokenAmount("1500000000000000000", 18)).toBe("1.5");
  });

  it("renders a negative amount", () => {
    expect(formatTokenAmount("-500000000000000000", 18)).toBe("-0.5");
  });

  it("renders zero", () => {
    expect(formatTokenAmount("0", 18)).toBe("0");
  });

  it("respects a token's own decimals (e.g. 6 for USDC)", () => {
    expect(formatTokenAmount("1234560", 6)).toBe("1.23456");
  });
});

describe("formatWeth", () => {
  it("is formatTokenAmount fixed at 18 decimals", () => {
    expect(formatWeth("2000000000000000000")).toBe("2");
  });
});

describe("formatPct", () => {
  it("signs a positive value", () => {
    expect(formatPct(12.345)).toBe("+12.35%");
  });

  it("does not double-sign a negative value", () => {
    expect(formatPct(-16.66)).toBe("-16.66%");
  });

  it("does not sign zero", () => {
    expect(formatPct(0)).toBe("0.00%");
  });
});

describe("formatWinRate", () => {
  it("renders a 0..1 ratio as a percentage", () => {
    expect(formatWinRate(0.5)).toBe("50.0%");
    expect(formatWinRate(0)).toBe("0.0%");
    expect(formatWinRate(1)).toBe("100.0%");
  });
});

describe("shortenAddress", () => {
  it("keeps the 0x prefix and the last 4 chars", () => {
    expect(shortenAddress("0x1111111111111111111111111111111111111111")).toBe("0x1111…1111");
  });
});
