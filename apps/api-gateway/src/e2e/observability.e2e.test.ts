import { toAddress, tokenAmount, type Trade } from "@bot/domain";
import { createEvent } from "@bot/events";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, ADMIN_EMAIL, ADMIN_PASSWORD, type TestApp } from "./test-app";

const WETH = toAddress("0x4200000000000000000000000000000000000006");

function buyTrade(id: string): Trade {
  return {
    id,
    chainId: 8453,
    side: "buy",
    token: WETH,
    amountIn: tokenAmount(1_000_000n, 6),
    amountOut: tokenAmount(1_000_000_000_000_000_000n, 18),
    txHash: `0x${"b".repeat(64)}`,
    simulated: false,
  };
}

describe("observability e2e", () => {
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

  it("GET /metrics requires authentication", async () => {
    const response = await request(server).get("/metrics");
    expect(response.status).toBe(401);
  });

  it("GET /metrics returns Prometheus text for an authorized caller", async () => {
    const response = await request(server)
      .get("/metrics")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["content-type"]).toContain("version=0.0.4");
    expect(response.text).toContain("# TYPE bot_events_published_total counter");
  });

  it("meters a published event and writes it to the audit trail", async () => {
    await testApp.bus.publish(
      createEvent("trade.executed", { trade: buyTrade("obs-1") }, { source: "engine" }),
    );

    // Audit trail captured the money-moving action, without secrets.
    const records = testApp.auditSink.list();
    const audited = records.find(
      (record) => record.id !== undefined && record.action === "trade.executed",
    );
    expect(audited).toBeDefined();
    expect(audited!.subject).toBe(WETH);
    expect(audited!.detail.txHash).toBe(`0x${"b".repeat(64)}`);

    // The metered bus counted the publish and the consumer deliveries.
    const metrics = await request(server)
      .get("/metrics")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(metrics.text).toContain('bot_events_published_total{type="trade.executed"} 1');
    expect(metrics.text).toContain('bot_events_consumed_total{type="trade.executed"}');
  });
});
