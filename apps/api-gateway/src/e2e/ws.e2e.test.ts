import type { AddressInfo } from "node:net";
import { toAddress } from "@bot/domain";
import { createEvent } from "@bot/events";
import request from "supertest";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_EMAIL, ADMIN_PASSWORD, createTestApp, type TestApp } from "./test-app";

interface Frame {
  event: string;
  data: unknown;
}

/** Collects incoming frames and lets a test await the next one. */
class FrameReader {
  readonly #frames: Frame[] = [];
  readonly #waiters: Array<(frame: Frame) => void> = [];

  constructor(socket: WebSocket) {
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      const waiter = this.#waiters.shift();
      if (waiter) {
        waiter(frame);
      } else {
        this.#frames.push(frame);
      }
    });
  }

  next(timeoutMs = 2_000): Promise<Frame> {
    const buffered = this.#frames.shift();
    if (buffered) {
      return Promise.resolve(buffered);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for frame")), timeoutMs);
      this.#waiters.push((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  }
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once("close", (code) => resolve(code));
  });
}

const FIXTURE_TOKEN = {
  chainId: 8453 as const,
  address: toAddress("0x4200000000000000000000000000000000000006"),
  symbol: "WETH",
  name: "Wrapped Ether",
  decimals: 18,
};

describe("websocket event feed e2e", () => {
  let testApp: TestApp;
  let baseUrl: string;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    await testApp.app.listen(0);
    const { port } = testApp.app.getHttpServer().address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}/ws`;
    const login = await request(testApp.app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = (login.body as { token: string }).token;
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it("closes unauthenticated connections with 4401", async () => {
    const socket = new WebSocket(baseUrl);
    await opened(socket);
    await expect(closed(socket)).resolves.toBe(4401);
  });

  it("closes connections with a bad token with 4401", async () => {
    const socket = new WebSocket(`${baseUrl}?token=garbage`);
    await opened(socket);
    await expect(closed(socket)).resolves.toBe(4401);
  });

  it("streams subscribed topics, and only those", async () => {
    const socket = new WebSocket(`${baseUrl}?token=${adminToken}`);
    const reader = new FrameReader(socket);
    await opened(socket);

    socket.send(JSON.stringify({ event: "subscribe", data: { types: ["token.detected"] } }));
    await expect(reader.next()).resolves.toEqual({
      event: "subscribed",
      data: { types: ["token.detected"] },
    });

    // A subscribed topic arrives...
    await testApp.bus.publish(
      createEvent("token.detected", { token: FIXTURE_TOKEN }, { source: "test" }),
    );
    const frame = await reader.next();
    expect(frame.event).toBe("event");
    expect(frame.data).toMatchObject({
      type: "token.detected",
      source: "test",
      payload: { token: { symbol: "WETH" } },
    });

    // ...an unsubscribed one does not (the next frame is the pool.created echo
    // after we subscribe to it, not a stale token.detected).
    await testApp.bus.publish(
      createEvent(
        "pool.created",
        {
          pool: {
            chainId: 8453 as const,
            address: toAddress("0x00000000000000000000000000000000000000bb"),
            dex: "uniswap-v2" as const,
            token0: FIXTURE_TOKEN.address,
            token1: toAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
          },
        },
        { source: "test" },
      ),
    );
    socket.send(JSON.stringify({ event: "subscribe", data: { types: ["pool.created"] } }));
    const next = await reader.next();
    expect(next.event).toBe("subscribed");

    socket.close();
  });

  it("rejects unknown topics", async () => {
    const socket = new WebSocket(`${baseUrl}?token=${adminToken}`);
    const reader = new FrameReader(socket);
    await opened(socket);

    socket.send(JSON.stringify({ event: "subscribe", data: { types: ["nope.nope"] } }));
    await expect(reader.next()).resolves.toMatchObject({
      event: "error",
      data: { code: "VALIDATION_ERROR" },
    });
    socket.close();
  });

  it("unsubscribe stops the flow", async () => {
    const socket = new WebSocket(`${baseUrl}?token=${adminToken}`);
    const reader = new FrameReader(socket);
    await opened(socket);

    socket.send(JSON.stringify({ event: "subscribe", data: { types: ["token.detected"] } }));
    await reader.next();
    socket.send(JSON.stringify({ event: "unsubscribe", data: { types: ["token.detected"] } }));
    await expect(reader.next()).resolves.toEqual({ event: "subscribed", data: { types: [] } });

    await testApp.bus.publish(
      createEvent("token.detected", { token: FIXTURE_TOKEN }, { source: "test" }),
    );
    await expect(reader.next(300)).rejects.toThrow(/timed out/);
    socket.close();
  });
});
