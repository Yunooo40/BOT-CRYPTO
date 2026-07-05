/**
 * The permission model: three coarse scopes checked on every route and every
 * WebSocket topic. Fine-grained per-resource permissions can layer on top
 * later without changing the wire contract.
 */
export const SCOPES = ["read", "trade", "admin"] as const;

export type Scope = (typeof SCOPES)[number];

export type Role = "admin" | "viewer";

/** What a JWT session can do, derived from the user's role. */
export function scopesForRole(role: Role): Scope[] {
  switch (role) {
    case "admin":
      return [...SCOPES];
    case "viewer":
      return ["read"];
  }
}
