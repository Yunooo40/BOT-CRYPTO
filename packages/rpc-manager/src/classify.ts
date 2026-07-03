import { RpcError, RpcRequestError } from "viem";

/**
 * JSON-RPC error codes that indict the node rather than the request:
 * -32700 the node returned unparsable JSON, -32603 internal error,
 * -32005 limit exceeded (rate limit). Another endpoint may well succeed.
 */
const NODE_FAULT_CODES = new Set([-32700, -32603, -32005]);

/**
 * True when the error condemns the *endpoint* — network failure, timeout,
 * HTTP error, node fault — and the request should fail over.
 *
 * False for application-level JSON-RPC errors (revert, invalid params, unknown
 * method...): the node answered, so it is alive, and the same request would
 * fail identically on every other node. Those must surface to the caller
 * unchanged — a honeypot revert wrapped in a retryable infra error would be a
 * trading bug, not a resilience feature.
 *
 * Both viem hierarchies are handled: raw `RpcRequestError` (transport level)
 * and the mapped `RpcError` subclasses viem's request layer produces
 * (`InternalRpcError`, `LimitExceededRpcError`, ...).
 */
export function isEndpointFailure(error: unknown): boolean {
  if (error instanceof RpcRequestError || error instanceof RpcError) {
    return NODE_FAULT_CODES.has(error.code);
  }
  // HttpRequestError, TimeoutError, DNS/socket failures, anything unclassified:
  // assume the endpoint is at fault and try the next one.
  return true;
}
