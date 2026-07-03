import { InfraError } from "@bot/errors";

/**
 * Every configured endpoint is down, cooling off, or failed the request.
 * Retryable by classification (`instanceof InfraError`): the pool's health
 * checks keep probing in the background, so a later attempt may succeed.
 */
export class RpcInfraError extends InfraError {
  override readonly code: string = "RPC_UNAVAILABLE";
}
