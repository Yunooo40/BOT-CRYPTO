import { BaseError, DomainError, InfraError, ValidationError } from "@bot/errors";
import type { Logger } from "@bot/logger";
import { PoolNotFoundError } from "@bot/dex-adapters";
import {
  Catch,
  HttpException,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { LOGGER } from "../tokens";
import type { GatewayRequest } from "./http";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    /** Per-field validation issues; only ever request-shaped data, no internals. */
    details?: Array<{ path: string; message: string }>;
  };
  requestId?: string;
}

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE",
  429: "RATE_LIMITED",
};

function httpExceptionMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === "string") {
    return response;
  }
  if (typeof response === "object" && response !== null && "message" in response) {
    const message = (response as { message: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
    if (Array.isArray(message)) {
      return message.join("; ");
    }
  }
  return exception.message;
}

/**
 * The single place errors become HTTP. Maps the platform hierarchy —
 * ValidationError → 400, DomainError → 422 (PoolNotFound → 404),
 * InfraError → 503 — and never leaks stacks, contexts or secrets: the body
 * carries a stable machine code, a human message, and the request id.
 */
@Catch()
export class GatewayExceptionFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<GatewayRequest>();

    let status: number;
    let code: string;
    let message: string;
    let details: ErrorBody["error"]["details"];

    // Third-party layers wrap our errors (viem buries the pool's RpcInfraError
    // under a ContractFunctionExecutionError), so classify on the first
    // platform error found along the cause chain, not just the surface.
    const platformError = findPlatformError(exception);

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? "HTTP_ERROR";
      message = httpExceptionMessage(exception);
    } else if (platformError instanceof ValidationError) {
      status = 400;
      code = platformError.code;
      message = platformError.message;
      details = extractIssues(platformError);
    } else if (platformError instanceof PoolNotFoundError) {
      status = 404;
      code = platformError.code;
      message = platformError.message;
    } else if (platformError instanceof DomainError) {
      status = 422;
      code = platformError.code;
      message = platformError.message;
    } else if (platformError instanceof InfraError) {
      status = 503;
      code = platformError.code;
      message = "A dependency is unavailable, retry later";
    } else {
      status = 500;
      code = "INTERNAL_ERROR";
      message = "Internal server error";
    }

    const log = { requestId: request.requestId, method: request.method, path: request.url };
    if (status >= 500) {
      this.logger.error({ ...log, err: exception }, "request failed");
    } else {
      this.logger.debug({ ...log, status, code }, "request rejected");
    }

    const body: ErrorBody = {
      error: { code, message, ...(details !== undefined ? { details } : {}) },
      ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
    };
    response.status(status).json(body);
  }
}

/** First platform error on the cause chain, the thrown value included. */
function findPlatformError(exception: unknown): BaseError | undefined {
  for (
    let current = exception;
    current !== null && typeof current === "object";
    current = (current as { cause?: unknown }).cause ?? null
  ) {
    if (current instanceof BaseError) {
      return current;
    }
  }
  return undefined;
}

function extractIssues(error: ValidationError): ErrorBody["error"]["details"] {
  const issues = error.context?.issues;
  if (!Array.isArray(issues)) {
    return undefined;
  }
  const details = issues
    .filter(
      (issue): issue is { path: unknown; message: unknown } =>
        typeof issue === "object" && issue !== null,
    )
    .map((issue) => ({ path: String(issue.path ?? ""), message: String(issue.message ?? "") }));
  return details.length > 0 ? details : undefined;
}
