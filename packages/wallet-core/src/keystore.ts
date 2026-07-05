import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { ValidationError } from "@bot/errors";
import { KeystoreIntegrityError } from "./errors";

/**
 * Envelope encryption for private keys.
 *
 * - AES-256-GCM: authenticated — any bit flipped anywhere in the envelope (or
 *   a wrong master key) fails the tag check; there is no partial decryption.
 * - The key-encryption key is derived from the master passphrase with scrypt
 *   (N=2^15, r=8, p=1) and a fresh 16-byte salt per envelope.
 * - The wallet address is bound as AAD: an envelope copied onto another
 *   wallet's row refuses to open.
 * - Wire format is versioned: `v1:<salt>:<iv>:<ciphertext>:<tag>` (base64
 *   fields), so the scrypt/AES parameters can evolve without breaking stored
 *   keys.
 */

const VERSION = "v1";
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
// Node requires maxmem > 128·N·r (~33.5 MiB here); give it headroom.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function deriveKek(masterKey: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      masterKey,
      salt,
      KEY_BYTES,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (error, key) => (error !== null ? reject(error) : resolve(key)),
    );
  });
}

export class Keystore {
  readonly #masterKey: string;
  /**
   * Derived-key cache by salt: scrypt is deliberately slow (~tens of ms), and
   * the trading hot path signs with the same few wallets over and over.
   */
  readonly #kekCache = new Map<string, Buffer>();
  readonly #kekCacheLimit: number;

  constructor(masterKey: string, options: { kekCacheLimit?: number } = {}) {
    if (masterKey.length < 16) {
      throw new ValidationError("Wallet master key must be at least 16 characters");
    }
    this.#masterKey = masterKey;
    this.#kekCacheLimit = options.kekCacheLimit ?? 128;
  }

  /** Encrypt `plaintext`, bound to `aad` (the wallet address). */
  async seal(plaintext: Buffer, aad: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const kek = await this.#kek(salt);
    const cipher = createCipheriv("aes-256-gcm", kek, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      salt.toString("base64"),
      iv.toString("base64"),
      ciphertext.toString("base64"),
      tag.toString("base64"),
    ].join(":");
  }

  /**
   * Decrypt an envelope. The caller owns the returned buffer and must zeroize
   * it (`buffer.fill(0)`) as soon as the secret has been used.
   * @throws {KeystoreIntegrityError} on tampering, wrong AAD or wrong master key.
   */
  async open(envelope: string, aad: string): Promise<Buffer> {
    const parts = envelope.split(":");
    if (parts.length !== 5) {
      throw new KeystoreIntegrityError("Malformed keystore envelope");
    }
    const [version, saltB64 = "", ivB64 = "", ciphertextB64 = "", tagB64 = ""] = parts;
    if (version !== VERSION) {
      throw new KeystoreIntegrityError(`Unsupported keystore envelope version: "${version}"`);
    }
    const salt = Buffer.from(saltB64, "base64");
    const iv = Buffer.from(ivB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || tag.length !== 16) {
      throw new KeystoreIntegrityError("Malformed keystore envelope");
    }
    const kek = await this.#kek(salt);
    const decipher = createDecipheriv("aes-256-gcm", kek, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      // GCM cannot (and should not) distinguish corruption, a replayed
      // envelope or a wrong passphrase — neither do we.
      throw new KeystoreIntegrityError("Keystore envelope failed authentication");
    }
  }

  async #kek(salt: Buffer): Promise<Buffer> {
    const cacheKey = salt.toString("base64");
    const cached = this.#kekCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const kek = await deriveKek(this.#masterKey, salt);
    if (this.#kekCache.size >= this.#kekCacheLimit) {
      // Drop the oldest entry (insertion order) — plain FIFO is enough here.
      const oldest = this.#kekCache.keys().next().value;
      if (oldest !== undefined) {
        this.#kekCache.get(oldest)?.fill(0);
        this.#kekCache.delete(oldest);
      }
    }
    this.#kekCache.set(cacheKey, kek);
    return kek;
  }
}
