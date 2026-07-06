import { redirect } from "next/navigation";
import { getSessionToken } from "./auth";
import { env } from "./env";
import type { AnalyticsSummary, Position, TradesPage } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Every gateway call: attaches the session bearer token, sends to `/login` if there is none or it's stale. */
async function gatewayGet<T>(path: string): Promise<T> {
  const token = await getSessionToken();
  if (token === undefined) {
    redirect("/login");
  }
  const response = await fetch(`${env.API_GATEWAY_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) {
    redirect("/login");
  }
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  return (await response.json()) as T;
}

export function getPositions(): Promise<Position[]> {
  return gatewayGet<Position[]>("/v1/positions");
}

export function getTrades(cursor?: string, limit = 25): Promise<TradesPage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor !== undefined) {
    query.set("cursor", cursor);
  }
  return gatewayGet<TradesPage>(`/v1/trades?${query.toString()}`);
}

export function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  return gatewayGet<AnalyticsSummary>("/v1/analytics/summary");
}
