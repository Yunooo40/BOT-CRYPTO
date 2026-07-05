import { InfraError } from "@bot/errors";

/**
 * Minimal HTTP surface the notifiers need. Injected everywhere so tests never
 * touch the network; defaults to `fetch`. No heavy HTTP dependency.
 */
export interface HttpClient {
  post(
    url: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }>;
}

/** True for statuses worth retrying: network/5xx/429. 4xx (except 429) are terminal. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * Raise the right error class for an HTTP status: `InfraError` (retryable) for
 * 5xx/429, a plain non-retryable Error for other 4xx. A 2xx returns quietly.
 */
export function assertOkStatus(status: number, channel: string, body: string): void {
  if (status >= 200 && status < 300) {
    return;
  }
  const message = `${channel} responded ${status}: ${body.slice(0, 200)}`;
  if (isRetryableStatus(status)) {
    throw new InfraError(message, { context: { status, channel } });
  }
  throw new Error(message);
}

/** `fetch`-backed client. The only place the process reaches the network. */
export const fetchHttpClient: HttpClient = {
  async post(url, body, headers) {
    try {
      const response = await fetch(url, { method: "POST", body, headers });
      return { status: response.status, body: await response.text() };
    } catch (error) {
      // DNS/socket failures are transient — surface as retryable infra errors.
      throw new InfraError("HTTP request failed", { cause: error, context: { url } });
    }
  },
};
