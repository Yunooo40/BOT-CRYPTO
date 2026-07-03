import type { Env } from "@bot/config";
import { ValidationError } from "@bot/errors";
import { z } from "zod";

const httpUrlSchema = z
  .string()
  .url()
  .refine((url) => url.startsWith("https://") || url.startsWith("http://"), {
    message: "must be an http(s):// URL",
  });

const wsUrlSchema = z
  .string()
  .url()
  .refine((url) => url.startsWith("wss://") || url.startsWith("ws://"), {
    message: "must be a ws(s):// URL",
  });

/** One RPC endpoint of the pool. Weight sets its share of traffic (default 1). */
export const rpcEndpointSchema = z.object({
  url: httpUrlSchema,
  weight: z.number().int().min(1).max(100).default(1),
  /** Optional WebSocket URL for future subscriptions (Scanner, M5). Unused in M2. */
  wsUrl: wsUrlSchema.optional(),
});

export type RpcEndpointConfig = z.infer<typeof rpcEndpointSchema>;
export type RpcEndpointInput = z.input<typeof rpcEndpointSchema>;

/**
 * Parse the `BASE_RPC_URLS` wire format: comma-separated entries, each
 * `url[|weight][|wsUrl]` — e.g.
 * `https://mainnet.base.org,https://node.example|3|wss://node.example`.
 *
 * @throws {ValidationError} listing every invalid entry at once.
 */
export function parseRpcEndpoints(raw: string): RpcEndpointConfig[] {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    throw new ValidationError("BASE_RPC_URLS must list at least one RPC endpoint");
  }

  const problems: string[] = [];
  const endpoints: RpcEndpointConfig[] = [];

  entries.forEach((entry, index) => {
    const [url = "", weightPart, wsPart, ...extra] = entry.split("|").map((part) => part.trim());
    if (extra.length > 0) {
      problems.push(`  - entry ${index + 1} ("${entry}"): too many "|" segments`);
      return;
    }
    const parsed = rpcEndpointSchema.safeParse({
      url,
      ...(weightPart !== undefined && weightPart !== "" ? { weight: Number(weightPart) } : {}),
      ...(wsPart !== undefined && wsPart !== "" ? { wsUrl: wsPart } : {}),
    });
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "entry"}: ${issue.message}`)
        .join("; ");
      problems.push(`  - entry ${index + 1} ("${entry}"): ${details}`);
      return;
    }
    endpoints.push(parsed.data);
  });

  const seen = new Set<string>();
  for (const endpoint of endpoints) {
    if (seen.has(endpoint.url)) {
      problems.push(`  - duplicate endpoint URL: ${endpoint.url}`);
    }
    seen.add(endpoint.url);
  }

  if (problems.length > 0) {
    throw new ValidationError(`Invalid RPC endpoint configuration:\n${problems.join("\n")}`, {
      context: { raw },
    });
  }

  return endpoints;
}

/** Read the pool's endpoints from a validated environment (`@bot/config`). */
export function rpcEndpointsFromEnv(env: Pick<Env, "BASE_RPC_URLS">): RpcEndpointConfig[] {
  return parseRpcEndpoints(env.BASE_RPC_URLS);
}
