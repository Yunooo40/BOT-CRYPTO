import type { Role, Scope } from "./scopes";

/**
 * Who is calling — the outcome of authentication, attached to the request and
 * to WebSocket connections. Everything downstream (scope checks, rate-limit
 * keys, ownership of API keys) reads this and never re-parses credentials.
 */
export type Principal =
  | { kind: "user"; userId: string; email: string; role: Role; scopes: Scope[] }
  | { kind: "api-key"; userId: string; apiKeyId: string; scopes: Scope[] };
