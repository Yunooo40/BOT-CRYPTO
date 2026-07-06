import { z } from "zod";

/**
 * Dashboard-only env, validated the same way as `@bot/config` (fail-fast, one
 * call site) — kept local rather than importing `@bot/config`'s schema, which
 * requires gateway-only secrets (JWT_SECRET, DATABASE_URL...) this
 * browser-facing app never holds.
 */
const envSchema = z.object({
  /** Server-side base URL of the API Gateway (M12), e.g. http://localhost:3000. */
  API_GATEWAY_URL: z.string().url().default("http://localhost:3000"),
  /** Browser-facing WS URL — the client opens this directly (see components/LiveRefresh). */
  NEXT_PUBLIC_API_GATEWAY_WS_URL: z.string().url().default("ws://localhost:3000"),
});

export const env = envSchema.parse(process.env);
