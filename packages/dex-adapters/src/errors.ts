import { DomainError } from "@bot/errors";

/**
 * The requested pool does not exist on that venue (factory returned the zero
 * address). Not retryable: asking again won't create the pool.
 */
export class PoolNotFoundError extends DomainError {
  override readonly code: string = "POOL_NOT_FOUND";
}
