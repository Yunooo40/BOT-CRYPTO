import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_KEY_PATTERN } from "../auth/api-key";
import { ADMIN_EMAIL, ADMIN_PASSWORD, createTestApp, type TestApp } from "./test-app";

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("api-gateway e2e", () => {
  let testApp: TestApp;
  let server: ReturnType<TestApp["app"]["getHttpServer"]>;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    server = testApp.app.getHttpServer();
    const login = await request(server)
      .post("/v1/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = (login.body as { token: string }).token;
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe("health & status", () => {
    it("GET /health is public", async () => {
      const response = await request(server).get("/health");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "ok" });
    });

    it("GET /v1/status requires auth", async () => {
      const response = await request(server).get("/v1/status");
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    });

    it("GET /v1/status reports components with a JWT", async () => {
      const response = await request(server)
        .get("/v1/status")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: "ok",
        components: [{ name: "fake", ok: true }],
      });
    });
  });

  describe("login", () => {
    it("rejects a malformed body with field details", async () => {
      const response = await request(server).post("/v1/auth/login").send({ email: "not-mail" });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
      const details = (
        response.body as { error: { details: Array<{ path: string }> } }
      ).error.details.map((detail) => detail.path);
      expect(details).toEqual(expect.arrayContaining(["email", "password"]));
    });

    it("rejects wrong credentials with one uniform message", async () => {
      const wrongPassword = await request(server)
        .post("/v1/auth/login")
        .send({ email: ADMIN_EMAIL, password: "wrong-password-1" });
      const unknownUser = await request(server)
        .post("/v1/auth/login")
        .send({ email: "ghost@test.dev", password: "wrong-password-1" });
      expect(wrongPassword.status).toBe(401);
      expect(unknownUser.status).toBe(401);
      expect(wrongPassword.body).toEqual(unknownUser.body);
    });

    it("returns a bearer token on success", async () => {
      const response = await request(server)
        .post("/v1/auth/login")
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ tokenType: "Bearer", expiresInSeconds: 43_200 });
      expect((response.body as { token: string }).token.split(".")).toHaveLength(3);
    });
  });

  describe("quotes", () => {
    it("quotes a pair, bigints rendered as strings", async () => {
      const response = await request(server)
        .get("/v1/quotes")
        .query({ tokenIn: WETH, tokenOut: USDC, amountIn: "1000000000000000000" })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        venue: "uniswap-v2",
        tokenIn: WETH.toLowerCase(),
        tokenOut: USDC.toLowerCase(),
        amountIn: "1000000000000000000",
        amountOut: "2000000000000000000",
        priceImpactBps: 12,
      });
    });

    it("rejects a malformed address", async () => {
      const response = await request(server)
        .get("/v1/quotes")
        .query({ tokenIn: "0x123", tokenOut: USDC, amountIn: "1" })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    });

    it("rejects identical tokenIn/tokenOut", async () => {
      const response = await request(server)
        .get("/v1/quotes")
        .query({ tokenIn: WETH, tokenOut: WETH, amountIn: "1" })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(response.status).toBe(400);
    });

    it("maps PoolNotFoundError to 404", async () => {
      const response = await request(server)
        .get("/v1/quotes")
        .query({
          tokenIn: "0x000000000000000000000000000000000000dEaD",
          tokenOut: USDC,
          amountIn: "1",
        })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ error: { code: "POOL_NOT_FOUND" } });
    });

    it("maps an infra error buried under a third-party wrapper to 503", async () => {
      const response = await request(server)
        .get("/v1/quotes")
        .query({
          tokenIn: "0x000000000000000000000000000000000000d011",
          tokenOut: USDC,
          amountIn: "1",
        })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ error: { code: "RPC_UNAVAILABLE" } });
    });
  });

  describe("api keys", () => {
    it("full lifecycle: create → use → list → revoke → rejected", async () => {
      const created = await request(server)
        .post("/v1/api-keys")
        .send({ name: "bot", scopes: ["read"] })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(created.status).toBe(201);
      const { id, key, prefix } = created.body as { id: string; key: string; prefix: string };
      expect(key).toMatch(API_KEY_PATTERN);
      expect(prefix).toBe(key.slice(0, 11));
      expect(created.body).not.toHaveProperty("keyHash");

      // The key authenticates read routes...
      const quoted = await request(server)
        .get("/v1/quotes")
        .query({ tokenIn: WETH, tokenOut: USDC, amountIn: "5" })
        .set("Authorization", `Bearer ${key}`);
      expect(quoted.status).toBe(200);

      // ...but its read scope cannot manage keys.
      const forbidden = await request(server)
        .get("/v1/api-keys")
        .set("Authorization", `Bearer ${key}`);
      expect(forbidden.status).toBe(403);
      expect(forbidden.body).toMatchObject({ error: { code: "FORBIDDEN" } });

      // Listing (admin) shows metadata but never key material.
      const listed = await request(server)
        .get("/v1/api-keys")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(listed.status).toBe(200);
      const entry = (listed.body as Array<Record<string, unknown>>).find(
        (candidate) => candidate.id === id,
      );
      expect(entry).toMatchObject({ name: "bot", prefix, scopes: ["read"] });
      expect(entry).not.toHaveProperty("key");
      expect(entry).not.toHaveProperty("keyHash");

      // Revoke: 204, the key stops working, revoking again is a 404.
      const revoked = await request(server)
        .delete(`/v1/api-keys/${id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(revoked.status).toBe(204);
      const rejected = await request(server)
        .get("/v1/quotes")
        .query({ tokenIn: WETH, tokenOut: USDC, amountIn: "5" })
        .set("Authorization", `Bearer ${key}`);
      expect(rejected.status).toBe(401);
      const again = await request(server)
        .delete(`/v1/api-keys/${id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(again.status).toBe(404);
    });

    it("rejects an expiry in the past", async () => {
      const response = await request(server)
        .post("/v1/api-keys")
        .send({ name: "stale", scopes: ["read"], expiresAt: "2000-01-01T00:00:00Z" })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(response.status).toBe(400);
    });

    it("rejects an unknown scope", async () => {
      const response = await request(server)
        .post("/v1/api-keys")
        .send({ name: "bad", scopes: ["root"] })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(response.status).toBe(400);
    });

    it("rejects a made-up API key", async () => {
      const response = await request(server)
        .get("/v1/quotes")
        .query({ tokenIn: WETH, tokenOut: USDC, amountIn: "1" })
        .set("Authorization", `Bearer bk_${"0".repeat(64)}`);
      expect(response.status).toBe(401);
    });
  });

  it("shapes unknown routes like every other error", async () => {
    const response = await request(server).get("/v1/nope");
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("rate limiting e2e: login bucket", () => {
  let testApp: TestApp;
  let server: ReturnType<TestApp["app"]["getHttpServer"]>;

  beforeAll(async () => {
    testApp = await createTestApp({ RATE_LIMIT_LOGIN_PER_MINUTE: "2" });
    server = testApp.app.getHttpServer();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it("throttles login attempts by IP with Retry-After", async () => {
    const attempt = () =>
      request(server)
        .post("/v1/auth/login")
        .send({ email: "ghost@test.dev", password: "whatever-12345" });
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("rate limiting e2e: identity bucket", () => {
  let testApp: TestApp;
  let server: ReturnType<TestApp["app"]["getHttpServer"]>;

  beforeAll(async () => {
    testApp = await createTestApp({ RATE_LIMIT_PER_MINUTE: "2" });
    server = testApp.app.getHttpServer();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it("throttles authenticated traffic per identity", async () => {
    const login = await request(server)
      .post("/v1/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const token = (login.body as { token: string }).token;
    const call = () => request(server).get("/v1/status").set("Authorization", `Bearer ${token}`);
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.headers["x-ratelimit-limit"]).toBe("2");
  });

  it("never throttles the liveness probe", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await request(server).get("/health")).status).toBe(200);
    }
  });
});
