import { ValidationError } from "@bot/errors";
import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const validEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/bot",
  REDIS_URL: "redis://localhost:6379",
  BASE_RPC_URLS: "https://mainnet.base.org",
  JWT_SECRET: "0123456789abcdef0123456789abcdef",
  ADMIN_EMAIL: "admin@example.com",
  ADMIN_PASSWORD: "correct-horse-battery",
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

  it("applies the gateway defaults (M12)", () => {
    const env = loadEnv(validEnv);
    expect(env.API_PORT).toBe(3000);
    expect(env.JWT_TTL_SECONDS).toBe(43_200);
    expect(env.CORS_ORIGINS).toBe("");
    expect(env.RATE_LIMIT_PER_MINUTE).toBe(120);
    expect(env.RATE_LIMIT_LOGIN_PER_MINUTE).toBe(10);
  });

  it("coerces numeric gateway variables from strings", () => {
    const env = loadEnv({ ...validEnv, API_PORT: "8080", JWT_TTL_SECONDS: "900" });
    expect(env.API_PORT).toBe(8080);
    expect(env.JWT_TTL_SECONDS).toBe(900);
  });

  it("rejects a JWT secret shorter than 32 characters", () => {
    expect(() => loadEnv({ ...validEnv, JWT_SECRET: "too-short" })).toThrow(/JWT_SECRET/);
  });

  it("rejects an admin password shorter than 12 characters", () => {
    expect(() => loadEnv({ ...validEnv, ADMIN_PASSWORD: "short" })).toThrow(/ADMIN_PASSWORD/);
  });

  it("names the missing gateway variables", () => {
    expect(() => loadEnv({})).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({})).toThrow(/ADMIN_EMAIL/);
  });

  it("leaves Telegram alerting unset by default (log-only alerting)", () => {
    const env = loadEnv(validEnv);
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.TELEGRAM_ALERT_CHAT_ID).toBeUndefined();
  });

  it("accepts Telegram alerting config when both variables are set", () => {
    const env = loadEnv({
      ...validEnv,
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_ALERT_CHAT_ID: "-100200300",
    });
    expect(env.TELEGRAM_BOT_TOKEN).toBe("123:abc");
    expect(env.TELEGRAM_ALERT_CHAT_ID).toBe("-100200300");
  });
});
