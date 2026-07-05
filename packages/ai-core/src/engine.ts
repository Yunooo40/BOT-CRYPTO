import { createLogger, type Logger } from "@bot/logger";
import type { z } from "zod";
import { AiInfraError, AiValidationError } from "./errors";
import type { AiProvider } from "./ports";
import type { AiRequest, AiResponse } from "./types";

export interface AiEngineOptions {
  primary: AiProvider;
  /** Consulted only when the primary fails with a retryable {@link AiInfraError}. */
  fallback?: AiProvider;
  logger?: Logger;
  /** Retry attempts on the primary for `AiInfraError` (excludes the first try). Default 2. */
  maxRetries?: number;
  /** Base backoff in ms; doubles each retry, capped at 10× base. Default 250. */
  backoffMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Resilience layer over a provider: retries transient `AiInfraError`s with
 * bounded exponential backoff, then falls back to a secondary provider if the
 * primary keeps failing on infra. Domain/validation errors are terminal — never
 * retried. `completeJson` adds typed, schema-validated JSON output.
 */
export class AiEngine {
  readonly #primary: AiProvider;
  readonly #fallback: AiProvider | undefined;
  readonly #logger: Logger;
  readonly #maxRetries: number;
  readonly #backoffMs: number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: AiEngineOptions) {
    this.#primary = options.primary;
    this.#fallback = options.fallback;
    this.#logger = options.logger ?? createLogger({ name: "ai" });
    this.#maxRetries = options.maxRetries ?? 2;
    this.#backoffMs = options.backoffMs ?? 250;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  /** Complete a request with retry + fallback. */
  async complete(request: AiRequest): Promise<AiResponse> {
    try {
      return await this.#withRetry(this.#primary, request);
    } catch (error) {
      if (this.#fallback !== undefined && error instanceof AiInfraError) {
        this.#logger.warn(
          { err: error, from: this.#primary.name, to: this.#fallback.name },
          "primary AI provider failed, using fallback",
        );
        return this.#withRetry(this.#fallback, request);
      }
      throw error;
    }
  }

  /**
   * Complete with `responseFormat: "json"`, then parse and validate against a
   * Zod schema. A body that isn't JSON or doesn't match the schema is an
   * {@link AiValidationError} (non-retryable — the model produced bad output).
   */
  async completeJson<T>(request: AiRequest, schema: z.ZodType<T>): Promise<T> {
    const response = await this.complete({ ...request, responseFormat: "json" });
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(response.text));
    } catch (error) {
      throw new AiValidationError("model did not return valid JSON", {
        cause: error,
        context: { text: response.text.slice(0, 500) },
      });
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new AiValidationError("model JSON did not match schema", {
        context: { issues: result.error.issues.map((i) => i.path.join(".")) },
      });
    }
    return result.data;
  }

  async #withRetry(provider: AiProvider, request: AiRequest): Promise<AiResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      try {
        return await provider.complete(request);
      } catch (error) {
        lastError = error;
        if (!(error instanceof AiInfraError) || attempt === this.#maxRetries) {
          throw error;
        }
        const delay = Math.min(this.#backoffMs * 2 ** attempt, this.#backoffMs * 10);
        this.#logger.debug(
          { provider: provider.name, attempt, delayMs: delay },
          "retrying AI request after infra error",
        );
        await this.#sleep(delay);
      }
    }
    throw lastError;
  }
}

/** Tolerate models that wrap JSON in ```json fences despite instructions. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}
