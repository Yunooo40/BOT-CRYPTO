import { AiInfraError, errorFromStatus } from "../errors";

/**
 * POST JSON to `url` with a hard timeout, and return the parsed JSON body.
 * Network failures and aborts become retryable {@link AiInfraError}; non-2xx
 * responses map by status (429/5xx retryable, other 4xx not). The provider owns
 * request/response *shape*; this owns transport and error classification.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new AiInfraError(aborted ? `request timed out after ${timeoutMs}ms` : "network error", {
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  if (!response.ok) {
    throw errorFromStatus(response.status, `provider returned ${response.status}: ${raw.slice(0, 500)}`, {
      context: { status: response.status },
    });
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new AiInfraError("provider returned non-JSON body", { cause: error });
  }
}
