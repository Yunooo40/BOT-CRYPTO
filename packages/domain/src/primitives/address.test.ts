import { ValidationError } from "@bot/errors";
import { describe, expect, it } from "vitest";
import { isAddress, toAddress } from "./address";

describe("toAddress", () => {
  it("accepts a valid address and normalizes it to lowercase", () => {
    const address = toAddress("0xAbC0000000000000000000000000000000000001");
    expect(address).toBe("0xabc0000000000000000000000000000000000001");
  });

  it("throws ValidationError on a malformed address", () => {
    expect(() => toAddress("0x123")).toThrow(ValidationError);
    expect(() => toAddress("not-an-address")).toThrow(/Invalid EVM address/);
  });
});

describe("isAddress", () => {
  it("guards valid and invalid values", () => {
    expect(isAddress("0x0000000000000000000000000000000000000000")).toBe(true);
    expect(isAddress("0x123")).toBe(false);
    expect(isAddress(42)).toBe(false);
    expect(isAddress(null)).toBe(false);
  });

  it("rejects a non-normalized (checksummed) address, since an Address is lowercase", () => {
    const checksummed = "0xAbC0000000000000000000000000000000000001";
    // Well-formed shape, but not yet normalized — must go through toAddress first.
    expect(isAddress(checksummed)).toBe(false);
    expect(isAddress(toAddress(checksummed))).toBe(true);
  });
});
