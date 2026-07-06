import { toAddress, type Trade } from "@bot/domain";
import { createEvent } from "@bot/events";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_EMAIL, ADMIN_PASSWORD, createTestApp, type TestApp } from "./test-app";

const PEPE = toAddress("0x1111111111111111111111111111111111111111");

function hexTxHash(id: string): string {
  return `0x${Buffer.from(id).toString("hex").padEnd(64, "0").slice(0, 64)}`;
}

function trade(overrides: Partial<Trade> & Pick<Trade, "id" | "side">): Trade {
  return {
    chainId: 8453,
    token: PEPE,
    amountIn: { raw: 1_000_000_000_000_000_000n, decimals: 18 },
    amountOut: { raw: 1_000_000n, decimals: 18 },
    txHash: hexTxHash(overrides.id),
    simulated: true,
    ...overrides,
  };
}

describe("portfolio e2e (M13)", () => {
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

  it("requires auth on all three routes", async () => {
    const [positions, trades, analytics] = await Promise.all([
      request(server).get("/v1/positions"),
      request(server).get("/v1/trades"),
      request(server).get("/v1/analytics/summary"),
    ]);
    expect(positions.status).toBe(401);
    expect(trades.status).toBe(401);
    expect(analytics.status).toBe(401);
  });

  it("folds a buy into an open position, trade history and analytics", async () => {
    const buy = trade({ id: "buy-1", side: "buy" });
    await testApp.bus.publish(createEvent("trade.executed", { trade: buy }, { source: "engine" }));

    const positions = await request(server)
      .get("/v1/positions")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(positions.status).toBe(200);
    expect(positions.body).toEqual([
      expect.objectContaining({
        token: PEPE,
        simulated: true,
        amount: "1000000",
        costBasis: "1000000000000000000",
        realizedPnl: "0",
      }),
    ]);

    const trades = await request(server)
      .get("/v1/trades")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(trades.status).toBe(200);
    expect(trades.body).toMatchObject({
      items: [expect.objectContaining({ id: "buy-1", side: "buy", token: PEPE })],
    });

    const analytics = await request(server)
      .get("/v1/analytics/summary")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body).toMatchObject({
      totalTrades: 1,
      totalBuys: 1,
      totalSells: 0,
      totalDeployed: "1000000000000000000",
    });
  });

  it("closes the position on a matching sell and realizes PnL", async () => {
    const sell = trade({
      id: "sell-1",
      side: "sell",
      amountIn: { raw: 1_000_000n, decimals: 18 },
      amountOut: { raw: 1_200_000_000_000_000_000n, decimals: 18 },
    });
    await testApp.bus.publish(createEvent("trade.executed", { trade: sell }, { source: "engine" }));

    const positions = await request(server)
      .get("/v1/positions")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(positions.body).toEqual([]);

    const analytics = await request(server)
      .get("/v1/analytics/summary")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(analytics.body).toMatchObject({
      totalTrades: 2,
      totalSells: 1,
      winRate: 1,
      totalRealizedPnl: "200000000000000000",
    });
  });

  it("redelivering the same trade id does not double-count history", async () => {
    const buy = trade({ id: "buy-1", side: "buy" });
    await testApp.bus.publish(createEvent("trade.executed", { trade: buy }, { source: "engine" }));

    const trades = await request(server)
      .get("/v1/trades")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ limit: 100 });
    const ids = (trades.body as { items: Array<{ id: string }> }).items.map((item) => item.id);
    expect(ids.filter((id) => id === "buy-1")).toHaveLength(1);
  });

  it("paginates trade history", async () => {
    const response = await request(server)
      .get("/v1/trades")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ limit: 1 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ items: [expect.objectContaining({ id: "sell-1" })] });
    expect((response.body as { nextCursor?: string }).nextCursor).toBeDefined();
  });
});
