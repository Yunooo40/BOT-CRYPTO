import { ValidationError } from "@bot/errors";
import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const validEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/bot",
  REDIS_URL: "redis://localhost:6379",
  BASE_RPC_URLS: "https://mainnet.base.org",
} satisfies NodeJS.ProcessEnv;

describe("loadEnv", () => {
  it("parses a valid environment and applies defaults", () => {
    const env = loadEnv(validEnv);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.REDIS_URL).toBe(validEnv.REDIS_URL);
  });

  it("honours explicit values over defaults", () => {
    const env = loadEnv({ ...validEnv, NODE_ENV: "production", LOG_LEVEL: "warn" });
    expect(env.NODE_ENV).toBe("production");
    expect(env.LOG_LEVEL).toBe("warn");
  });

  it("throws a ValidationError naming a missing required variable", () => {
    expect(() => loadEnv({})).toThrow(ValidationError);
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({})).toThrow(/BASE_RPC_URLS/);
  });

  it("rejects an out-of-range enum value", () => {
    expect(() => loadEnv({ ...validEnv, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it("rejects a malformed URL", () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: "not-a-url" })).toThrow(ValidationError);
  });
});
