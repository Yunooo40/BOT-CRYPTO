import { InfraError, ValidationError, type BaseErrorOptions } from "@bot/errors";

/**
 * A transient AI provider failure — network error, timeout, 429, or 5xx.
 * Retryable (subclass of {@link InfraError}), so the engine backs off and retries.
 */
export class AiInfraError extends InfraError {
  override readonly code = "AI_INFRA_ERROR";
}

/**
 * A non-retryable AI failure — malformed request (4xx), unparsable/invalid JSON,
 * or an unknown provider. Deterministic: retrying the same input fails again.
 */
export class AiValidationError extends ValidationError {
  override readonly code = "AI_VALIDATION_ERROR";
}

/** Map an HTTP status to the right error class (429/5xx retryable, other 4xx not). */
export function errorFromStatus(
  status: number,
  message: string,
  options?: BaseErrorOptions,
): AiInfraError | AiValidationError {
  if (status === 429 || status >= 500) {
    return new AiInfraError(message, options);
  }
  return new AiValidationError(message, options);
}
