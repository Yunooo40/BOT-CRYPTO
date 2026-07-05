import { randomUUID } from "node:crypto";
import type { Logger } from "@bot/logger";
import type { NextFunction, Response } from "express";
import type { GatewayRequest } from "./http";

/**
 * Express middleware: stamps a request id (honouring an inbound
 * `x-request-id` so traces cross service boundaries), echoes it in the
 * response, and writes one structured access-log line per request.
 */
export function requestContext(logger: Logger) {
  return (request: GatewayRequest, response: Response, next: NextFunction): void => {
    const inbound = request.headers["x-request-id"];
    const requestId = typeof inbound === "string" && inbound.length > 0 ? inbound : randomUUID();
    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);

    const startedAt = process.hrtime.bigint();
    response.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info(
        {
          requestId,
          method: request.method,
          path: request.originalUrl ?? request.url,
          status: response.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        },
        "request",
      );
    });
    next();
  };
}
