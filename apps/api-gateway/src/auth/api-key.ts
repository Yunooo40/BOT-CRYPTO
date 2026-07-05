import { createHash, randomBytes } from "node:crypto";

/**
 * API keys: `bk_` + 32 random bytes in hex. Only the SHA-256 of the full key
 * is stored — a leaked database does not leak usable keys — plus a short
 * plaintext prefix so a user can tell their keys apart in listings.
 *
 * No per-key salt is needed: the key itself is 256 bits of entropy, so
 * rainbow/dictionary attacks against the hash are moot.
 */
export const API_KEY_PATTERN = /^bk_[0-9a-f]{64}$/;

/** Length of the display prefix, e.g. `bk_1a2b3c4d`. */
const PREFIX_LENGTH = 11;

export interface GeneratedApiKey {
  /** The full secret — shown to the caller exactly once, never stored. */
  key: string;
  /** SHA-256 of the key, hex — the only thing persisted. */
  keyHash: string;
  /** Plaintext display prefix (`bk_` + 8 hex chars). */
  prefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  const key = `bk_${randomBytes(32).toString("hex")}`;
  return { key, keyHash: hashApiKey(key), prefix: key.slice(0, PREFIX_LENGTH) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Cheap syntactic test to route a bearer token to key lookup vs JWT verify. */
export function looksLikeApiKey(token: string): boolean {
  return API_KEY_PATTERN.test(token);
}
