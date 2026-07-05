import type { Env } from "@bot/config";
import { describe, expect, it } from "vitest";
import { generateApiKey } from "./api-key";
import { AuthService } from "./auth.service";
import { InMemoryApiKeyRepository, InMemoryUserRepository } from "./in-memory";
import { JwtService } from "./jwt.service";
import { hashPassword } from "./password";

async function setup(nowMs = Date.now()) {
  const users = new InMemoryUserRepository();
  const apiKeys = new InMemoryApiKeyRepository();
  const jwt = new JwtService({
    JWT_SECRET: "0123456789abcdef0123456789abcdef",
    JWT_TTL_SECONDS: 3600,
  } as Env);
  const service = new AuthService(users, apiKeys, jwt, () => nowMs);
  const admin = await users.create({
    email: "admin@test.dev",
    passwordHash: await hashPassword("admin-password-123"),
    role: "admin",
  });
  return { users, apiKeys, jwt, service, admin };
}

describe("AuthService.login", () => {
  it("issues a token for valid credentials", async () => {
    const { service, jwt, admin } = await setup();
    const result = await service.login("admin@test.dev", "admin-password-123");
    expect(result).toBeDefined();
    expect(result?.expiresInSeconds).toBe(3600);
    await expect(jwt.verify(result?.token ?? "")).resolves.toMatchObject({ sub: admin.id });
  });

  it("is case-insensitive on the email", async () => {
    const { service } = await setup();
    await expect(service.login("ADMIN@Test.Dev", "admin-password-123")).resolves.toBeDefined();
  });

  it("rejects a wrong password and an unknown email identically", async () => {
    const { service } = await setup();
    await expect(service.login("admin@test.dev", "nope-nope-nope")).resolves.toBeUndefined();
    await expect(service.login("ghost@test.dev", "nope-nope-nope")).resolves.toBeUndefined();
  });
});

describe("AuthService.authenticate", () => {
  it("accepts a valid JWT and re-anchors it to the live user", async () => {
    const { service, admin } = await setup();
    const login = await service.login("admin@test.dev", "admin-password-123");
    const principal = await service.authenticate(login?.token ?? "");
    expect(principal).toEqual({
      kind: "user",
      userId: admin.id,
      email: "admin@test.dev",
      role: "admin",
      scopes: ["read", "trade", "admin"],
    });
  });

  it("rejects a garbage token", async () => {
    const { service } = await setup();
    await expect(service.authenticate("garbage")).resolves.toBeUndefined();
  });

  it("accepts a live API key and stamps its usage", async () => {
    const { service, apiKeys, admin } = await setup();
    const generated = generateApiKey();
    const record = await apiKeys.create({
      userId: admin.id,
      name: "bot",
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      scopes: ["read"],
      expiresAt: null,
    });
    const principal = await service.authenticate(generated.key);
    expect(principal).toEqual({
      kind: "api-key",
      userId: admin.id,
      apiKeyId: record.id,
      scopes: ["read"],
    });
    // touchLastUsed is fire-and-forget; give the microtask a beat.
    await new Promise((resolve) => setImmediate(resolve));
    const stored = await apiKeys.findByHash(generated.keyHash);
    expect(stored?.lastUsedAt).not.toBeNull();
  });

  it("rejects an unknown API key", async () => {
    const { service } = await setup();
    await expect(service.authenticate(generateApiKey().key)).resolves.toBeUndefined();
  });

  it("rejects a revoked API key", async () => {
    const { service, apiKeys, admin } = await setup();
    const generated = generateApiKey();
    const record = await apiKeys.create({
      userId: admin.id,
      name: "bot",
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      scopes: ["read"],
      expiresAt: null,
    });
    await apiKeys.revoke(record.id, admin.id);
    await expect(service.authenticate(generated.key)).resolves.toBeUndefined();
  });

  it("rejects an expired API key", async () => {
    const nowMs = Date.now();
    const { service, apiKeys, admin } = await setup(nowMs);
    const generated = generateApiKey();
    await apiKeys.create({
      userId: admin.id,
      name: "bot",
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      scopes: ["read"],
      expiresAt: new Date(nowMs - 1),
    });
    await expect(service.authenticate(generated.key)).resolves.toBeUndefined();
  });
});
