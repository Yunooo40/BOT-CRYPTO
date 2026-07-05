import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { API_KEY_PATTERN, generateApiKey, hashApiKey, looksLikeApiKey } from "./api-key";

describe("api keys", () => {
  it("generates keys in the documented format", () => {
    const { key, prefix, keyHash } = generateApiKey();
    expect(key).toMatch(API_KEY_PATTERN);
    expect(prefix).toBe(key.slice(0, 11));
    expect(keyHash).toBe(createHash("sha256").update(key).digest("hex"));
  });

  it("generates unique keys", () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key);
  });

  it("hashes deterministically", () => {
    const { key, keyHash } = generateApiKey();
    expect(hashApiKey(key)).toBe(keyHash);
  });

  it("routes bearer tokens correctly", () => {
    expect(looksLikeApiKey(generateApiKey().key)).toBe(true);
    expect(looksLikeApiKey("eyJhbGciOiJIUzI1NiJ9.e30.sig")).toBe(false);
    expect(looksLikeApiKey("bk_short")).toBe(false);
    expect(looksLikeApiKey(`BK_${"a".repeat(64)}`)).toBe(false);
  });
});
