import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Logger } from "@bot/logger";
import { serializeEvent, type DomainEvent, type EventBus, type Unsubscribe } from "@bot/events";
import { Inject, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type WsResponse,
} from "@nestjs/websockets";
import type { WebSocket } from "ws";
import { z } from "zod";
import { AuthService } from "../auth/auth.service";
import type { Principal } from "../auth/principal";
import { bearerToken } from "../common/http";
import { EVENT_BUS, LOGGER } from "../tokens";
import { EVENT_TYPES, isEventType, requiredScopeFor } from "./topics";

/** Close codes in the WS application range (4000-4999). */
const CLOSE_UNAUTHORIZED = 4401;
/** RFC 6455 policy violation — used for slow consumers we must shed. */
const CLOSE_POLICY = 1008;

const HEARTBEAT_INTERVAL_MS = 30_000;
/** A client this far behind gets disconnected instead of buffering forever. */
const MAX_BUFFERED_BYTES = 1_048_576;

const subscriptionSchema = z.object({ types: z.array(z.string()).nonempty() });

interface ClientState {
  principal: Principal;
  topics: Set<string>;
  isAlive: boolean;
}

interface ErrorPayload {
  code: string;
  message: string;
}

/**
 * `/ws` — the live event feed. Authenticate at the handshake (`?token=` or an
 * Authorization header), then drive it with JSON frames:
 *
 *   → {"event":"subscribe","data":{"types":["trade.executed"]}}
 *   ← {"event":"subscribed","data":{"types":["trade.executed"]}}
 *   ← {"event":"event","data":<DomainEvent>}          (as they happen)
 *
 * Fan-out subscribes to every catalog topic under a per-instance consumer
 * group: Redis Streams groups share work among members, so a UNIQUE group per
 * gateway instance is what turns work-sharing into broadcast. (The groups are
 * ephemeral leftovers in Redis; observability/cleanup is an M14 concern.)
 */
@WebSocketGateway({ path: "/ws" })
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  readonly #clients = new Map<WebSocket, ClientState>();
  /**
   * Authentication in flight, registered SYNCHRONOUSLY at connection time: a
   * client that sends `subscribe` right after `open` — before the async
   * credential check lands — must wait for it, not get rejected.
   */
  readonly #authenticating = new Map<WebSocket, Promise<ClientState | undefined>>();
  #unsubscribes: Unsubscribe[] = [];
  #heartbeat: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    const group = `api-gateway-${randomUUID()}`;
    this.#unsubscribes = await Promise.all(
      EVENT_TYPES.map((type) =>
        this.bus.subscribe(type, (event) => this.#fanOut(event), { group }),
      ),
    );
    this.#heartbeat = setInterval(() => this.#pingAll(), HEARTBEAT_INTERVAL_MS);
    this.#heartbeat.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.#heartbeat !== undefined) {
      clearInterval(this.#heartbeat);
    }
    await Promise.all(
      this.#unsubscribes.map((unsubscribe) => unsubscribe().catch(() => undefined)),
    );
  }

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    const pending = this.#authenticate(client, request);
    this.#authenticating.set(client, pending);
    void pending.finally(() => this.#authenticating.delete(client));
  }

  async #authenticate(
    client: WebSocket,
    request: IncomingMessage,
  ): Promise<ClientState | undefined> {
    const token = extractToken(request);
    const principal = token === undefined ? undefined : await this.auth.authenticate(token);
    if (principal === undefined) {
      client.close(CLOSE_UNAUTHORIZED, "Unauthorized");
      return undefined;
    }
    const state: ClientState = { principal, topics: new Set(), isAlive: true };
    client.on("pong", () => {
      state.isAlive = true;
    });
    this.#clients.set(client, state);
    return state;
  }

  /** The client's state, waiting out an authentication still in flight. */
  #stateFor(client: WebSocket): Promise<ClientState | undefined> {
    const ready = this.#clients.get(client);
    if (ready !== undefined) {
      return Promise.resolve(ready);
    }
    return this.#authenticating.get(client) ?? Promise.resolve(undefined);
  }

  handleDisconnect(client: WebSocket): void {
    this.#clients.delete(client);
    this.#authenticating.delete(client);
  }

  @SubscribeMessage("subscribe")
  async subscribe(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() body: unknown,
  ): Promise<WsResponse<{ types: string[] } | ErrorPayload>> {
    const state = await this.#stateFor(client);
    if (state === undefined) {
      return errorResponse("UNAUTHORIZED", "Connection is not authenticated");
    }
    const parsed = subscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", 'Expected {"types": [<event type>, ...]}');
    }
    for (const type of parsed.data.types) {
      if (!isEventType(type)) {
        return errorResponse("VALIDATION_ERROR", `Unknown event type "${type}"`);
      }
      const required = requiredScopeFor(type);
      if (!state.principal.scopes.includes(required)) {
        return errorResponse("FORBIDDEN", `Topic "${type}" requires scope "${required}"`);
      }
    }
    for (const type of parsed.data.types) {
      state.topics.add(type);
    }
    return { event: "subscribed", data: { types: [...state.topics] } };
  }

  @SubscribeMessage("unsubscribe")
  async unsubscribe(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() body: unknown,
  ): Promise<WsResponse<{ types: string[] } | ErrorPayload>> {
    const state = await this.#stateFor(client);
    if (state === undefined) {
      return errorResponse("UNAUTHORIZED", "Connection is not authenticated");
    }
    const parsed = subscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", 'Expected {"types": [<event type>, ...]}');
    }
    for (const type of parsed.data.types) {
      state.topics.delete(type);
    }
    return { event: "subscribed", data: { types: [...state.topics] } };
  }

  #fanOut(event: DomainEvent): void {
    // serializeEvent renders bigint payloads safely; hand-building the frame
    // keeps that guarantee (JSON.stringify would throw on bigint).
    const frame = `{"event":"event","data":${serializeEvent(event)}}`;
    for (const [client, state] of this.#clients) {
      if (!state.topics.has(event.type)) {
        continue;
      }
      if (client.readyState !== client.OPEN) {
        continue;
      }
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
        this.logger.warn({ topic: event.type }, "dropping slow websocket consumer");
        client.close(CLOSE_POLICY, "Slow consumer");
        this.#clients.delete(client);
        continue;
      }
      client.send(frame);
    }
  }

  #pingAll(): void {
    for (const [client, state] of this.#clients) {
      if (!state.isAlive) {
        client.terminate();
        this.#clients.delete(client);
        continue;
      }
      state.isAlive = false;
      client.ping();
    }
  }
}

/** Token from `?token=` (browsers can't set WS headers) or Authorization. */
function extractToken(request: IncomingMessage): string | undefined {
  const url = new URL(request.url ?? "/", "http://gateway.local");
  const fromQuery = url.searchParams.get("token");
  if (fromQuery !== null && fromQuery.length > 0) {
    return fromQuery;
  }
  return bearerToken(request.headers.authorization);
}

function errorResponse(code: string, message: string): WsResponse<ErrorPayload> {
  return { event: "error", data: { code, message } };
}
