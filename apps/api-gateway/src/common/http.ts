import type { Request } from "express";
import type { Principal } from "../auth/principal";

/** The express request enriched by our middleware/guards. */
export interface GatewayRequest extends Request {
  principal?: Principal;
  requestId?: string;
}

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const [scheme, token, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || token === undefined || rest.length > 0) {
    return undefined;
  }
  return token;
}

/** Best-effort client IP for rate-limit keys. */
export function clientIp(request: Pick<Request, "ip" | "socket">): string {
  return request.ip ?? request.socket.remoteAddress ?? "unknown";
}
