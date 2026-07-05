import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing on `node:crypto` scrypt — no native addon to build, no
 * supply-chain surface. Parameters follow OWASP's scrypt guidance
 * (N=2^15, r=8, p=1) and are stored inside each hash, so they can be raised
 * later without invalidating existing hashes.
 */
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** node:crypto rejects N=2^15/r=8 under its 32 MiB default; give it headroom. */
const MAX_MEMORY = 128 * 1024 * 1024;

function scryptAsync(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: n, r, p, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

/** Hash a password into a self-describing `scrypt$N$r$p$salt$key` string. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, KEY_LENGTH);
  return [
    "scrypt",
    SCRYPT_N.toString(),
    SCRYPT_R.toString(),
    SCRYPT_P.toString(),
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * Verify a password against a stored hash. Returns false — never throws — for
 * a malformed stored value, so a corrupt row reads as "wrong password" instead
 * of a 500 that leaks which accounts exist.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts;
  const n = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  try {
    const salt = Buffer.from(rawSalt ?? "", "base64");
    const expected = Buffer.from(rawKey ?? "", "base64");
    if (expected.length === 0) {
      return false;
    }
    const actual = await scryptAsync(password, salt, n, r, p, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * A real hash of an unguessable password, verified against when a login names
 * an unknown email — so "no such user" and "wrong password" take the same
 * time and the login endpoint doesn't leak which emails exist.
 */
export const DUMMY_PASSWORD_HASH =
  "scrypt$32768$8$1$xL4mmDCyllPoImtOEwUeaQ==$" +
  "S9tRifxAyRRZJKUdSJHy49VmqbYGjZ2S1B0FBUeytmO1jgLIgtSf9EQVUcGP3P6bnQ9CmZKrGZzZ5xTecdEDGg==";
