import { describe, expect, it } from "vitest";
import { BaseError, DomainError, InfraError, ValidationError, isBaseError } from "./index";

describe("error hierarchy", () => {
  it("carries a stable code, message, and class name", () => {
    const err = new DomainError("risk score too high");
    expect(err.code).toBe("DOMAIN_ERROR");
    expect(err.message).toBe("risk score too high");
    expect(err.name).toBe("DomainError");
  });

  it("is an instance of both Error and BaseError", () => {
    const err = new InfraError("rpc down");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BaseError);
    expect(isBaseError(err)).toBe(true);
  });

  it("preserves cause and structured context", () => {
    const cause = new Error("ECONNREFUSED");
    const err = new InfraError("rpc call failed", {
      cause,
      context: { url: "https://rpc.example" },
    });
    expect(err.cause).toBe(cause);
    expect(err.context).toEqual({ url: "https://rpc.example" });
  });

  it("distinguishes the concrete error types", () => {
    expect(new ValidationError("bad input").code).toBe("VALIDATION_ERROR");
    expect(new DomainError("x").code).not.toBe(new InfraError("y").code);
  });

  it("returns false for plain errors and non-errors", () => {
    expect(isBaseError(new Error("plain"))).toBe(false);
    expect(isBaseError("nope")).toBe(false);
    expect(isBaseError(null)).toBe(false);
  });
});
