import { describe, expect, it } from "vitest";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a password against its own hash", async () => {
    const hash = await hashPassword("correct-horse-battery");
    await expect(verifyPassword("correct-horse-battery", hash)).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    await expect(verifyPassword("wrong-horse", hash)).resolves.toBe(false);
  });

  it("salts every hash: same password, different hashes", async () => {
    const [first, second] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(first).not.toBe(second);
  });

  it("stores its parameters in the hash (self-describing format)", async () => {
    const hash = await hashPassword("whatever");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it("treats a malformed stored hash as a mismatch, not an error", async () => {
    await expect(verifyPassword("x", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "scrypt$abc$8$1$AA==$AA==")).resolves.toBe(false);
    await expect(verifyPassword("x", "")).resolves.toBe(false);
  });

  it("never matches the timing-equalisation dummy hash", async () => {
    await expect(verifyPassword("", DUMMY_PASSWORD_HASH)).resolves.toBe(false);
    await expect(verifyPassword("password", DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });
});
