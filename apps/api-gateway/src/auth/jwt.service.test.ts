import type { Env } from "@bot/config";
import { describe, expect, it } from "vitest";
import { JwtService } from "./jwt.service";

function makeService(overrides: Partial<Pick<Env, "JWT_SECRET" | "JWT_TTL_SECONDS">> = {}) {
  const env = {
    JWT_SECRET: "0123456789abcdef0123456789abcdef",
    JWT_TTL_SECONDS: 3600,
    ...overrides,
  } as Env;
  return new JwtService(env);
}

const claims = { sub: "user-1", email: "a@b.c", role: "admin" as const };

describe("JwtService", () => {
  it("round-trips claims", async () => {
    const service = makeService();
    const token = await service.sign(claims);
    await expect(service.verify(token)).resolves.toEqual(claims);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await makeService({ JWT_SECRET: "another-secret-another-secret-32" }).sign(
      claims,
    );
    await expect(makeService().verify(token)).resolves.toBeUndefined();
  });

  it("rejects an expired token", async () => {
    const service = makeService({ JWT_TTL_SECONDS: -10 });
    const token = await service.sign(claims);
    await expect(service.verify(token)).resolves.toBeUndefined();
  });

  it("rejects a tampered payload", async () => {
    const service = makeService();
    const token = await service.sign(claims);
    const [header = "", payload = "", signature = ""] = token.split(".");
    const forged = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<
      string,
      unknown
    >;
    forged.role = "admin";
    forged.sub = "someone-else";
    const tampered = [
      header,
      Buffer.from(JSON.stringify(forged)).toString("base64url"),
      signature,
    ].join(".");
    await expect(service.verify(tampered)).resolves.toBeUndefined();
  });

  it('rejects "alg":"none" tokens', async () => {
    const service = makeService();
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "user-1", email: "a@b.c", role: "admin" }),
    ).toString("base64url");
    await expect(service.verify(`${header}.${payload}.`)).resolves.toBeUndefined();
  });

  it("rejects structurally valid tokens with a malformed role", async () => {
    const service = makeService();
    // Sign a token whose role is not part of the model via a sibling service
    // sharing the secret, then check shape validation catches it.
    const token = await service.sign({ ...claims, role: "superuser" as never });
    await expect(service.verify(token)).resolves.toBeUndefined();
  });

  it("exposes its ttl for login responses", () => {
    expect(makeService({ JWT_TTL_SECONDS: 1234 }).ttlSeconds).toBe(1234);
  });
});
