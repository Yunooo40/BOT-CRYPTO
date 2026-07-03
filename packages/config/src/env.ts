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
  /**
   * Wallet master passphrase (M4): the AES-256-GCM key-encryption key is
   * derived from it (scrypt, per-record salt). Never logged, never stored.
   */
  WALLET_MASTER_KEY: z.string().min(16, "must be at least 16 characters"),
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
