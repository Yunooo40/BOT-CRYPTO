/**
 * Base error hierarchy shared across every service.
 *
 * The point is to make failures *classifiable* without string-matching messages:
 * a caller can branch on `instanceof InfraError` to decide whether to retry, or
 * read `.code` for structured logging and metrics.
 */

export type ErrorContext = Record<string, unknown>;

export interface BaseErrorOptions {
  /** The underlying error that triggered this one, preserved as `Error.cause`. */
  cause?: unknown;
  /** Structured, non-sensitive metadata for logs (never put secrets here). */
  context?: ErrorContext;
}

export abstract class BaseError extends Error {
  /** Stable, machine-readable identifier. Never localize or reword this. */
  abstract readonly code: string;

  readonly context?: ErrorContext;

  constructor(message: string, options?: BaseErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    // Without this the name would stay "Error" after transpilation.
    this.name = new.target.name;
    this.context = options?.context;
    // V8-only; keeps the constructor out of the captured stack.
    Error.captureStackTrace?.(this, new.target);
  }
}

/**
 * A business rule was violated (e.g. token risk score above the snipe threshold).
 * Expected, not a bug — do not retry, surface it to the user/strategy.
 */
export class DomainError extends BaseError {
  readonly code = "DOMAIN_ERROR";
}

/**
 * An external dependency failed (RPC node, database, DEX, queue).
 * Usually transient and safe to retry with backoff.
 */
export class InfraError extends BaseError {
  readonly code = "INFRA_ERROR";
}

/**
 * Input or configuration was invalid before any work began.
 * Deterministic — retrying the same input will fail again.
 */
export class ValidationError extends BaseError {
  readonly code = "VALIDATION_ERROR";
}

/** Type guard: true for any error in this hierarchy. */
export function isBaseError(value: unknown): value is BaseError {
  return value instanceof BaseError;
}
