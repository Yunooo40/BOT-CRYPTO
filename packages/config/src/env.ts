import { ValidationError } from "@bot/errors";
import { z } from "zod";

/**
 * The environment contract for the whole platform. Every service validates its
 * slice of this at boot and refuses to start on a bad config, so we never
 * discover a missing DATABASE_URL three seconds into a live trade.
 *
 * As modules land they extend this schema (RPC URLs, encryption keys, chain
 * config, notification tokens, ...).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  /**
   * Base RPC endpoints (M2): comma-separated `url[|weight][|wsUrl]` entries,
   * e.g. `https://mainnet.base.org,https://base.example.com|3|wss://base.example.com`.
   * Only presence is checked here; `@bot/rpc-manager` validates each entry.
   */
  BASE_RPC_URLS: z.string().min(1),

  // --- API Gateway (M12) ---

  /** HTTP/WebSocket listen port of the gateway. */
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  /**
   * HMAC secret for HS256 access tokens. 32+ chars so brute-forcing the
   * signature is not the cheapest way in. Rotating it invalidates every
   * outstanding token — that is the logout-everyone lever.
   */
  JWT_SECRET: z.string().min(32),
  /** Access-token lifetime in seconds. Default 12 h; no refresh tokens in M12. */
  JWT_TTL_SECONDS: z.coerce.number().int().positive().max(2_592_000).default(43_200),
  /**
   * The bootstrap admin account, upserted at gateway boot. The env is the
   * source of truth for THIS user: changing ADMIN_PASSWORD re-hashes it.
   */
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(12),
  /** Comma-separated origins allowed by CORS. Empty (default) = same-origin only. */
  CORS_ORIGINS: z.string().default(""),
  /** Sliding-window request budget per authenticated identity (or IP). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  /** Stricter per-IP budget for `POST /v1/auth/login` (brute-force damper). */
  RATE_LIMIT_LOGIN_PER_MINUTE: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate an environment source (defaults to `process.env`).
 *
 * @throws {ValidationError} with every failing variable listed, so a misconfig
 * is fixed in one pass instead of one variable at a time.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ValidationError(`Invalid environment configuration:\n${issues}`, {
      context: { invalidKeys: parsed.error.issues.map((issue) => issue.path.join(".")) },
    });
  }
  return parsed.data;
}
