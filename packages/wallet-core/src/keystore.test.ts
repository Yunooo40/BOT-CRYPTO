import { describe, expect, it } from "vitest";
import { ValidationError } from "@bot/errors";
import { KeystoreIntegrityError } from "./errors";
import { Keystore } from "./keystore";

const MASTER = "correct horse battery staple";
const AAD = "0x4200000000000000000000000000000000000006";

describe("Keystore", () => {
  it("round-trips a secret", async () => {
    const keystore = new Keystore(MASTER);
    const secret = Buffer.from("00".repeat(16) + "ff".repeat(16), "hex");
    const envelope = await keystore.seal(secret, AAD);
    expect(envelope.startsWith("v1:")).toBe(true);
    const opened = await keystore.open(envelope, AAD);
    expect(opened.equals(secret)).toBe(true);
  });

  it("rejects a short master key", () => {
    expect(() => new Keystore("too-short")).toThrow(ValidationError);
  });

  it("produces a distinct envelope per seal (fresh salt and nonce)", async () => {
    const keystore = new Keystore(MASTER);
    const secret = Buffer.from("secret");
    const first = await keystore.seal(secret, AAD);
    const second = await keystore.seal(secret, AAD);
    expect(first).not.toBe(second);
  });

  it("refuses to open with the wrong master key", async () => {
    const envelope = await new Keystore(MASTER).seal(Buffer.from("secret"), AAD);
    await expect(new Keystore("another master key entirely").open(envelope, AAD)).rejects.toThrow(
      KeystoreIntegrityError,
    );
  });

  it("refuses an envelope replayed against another address (AAD)", async () => {
    const keystore = new Keystore(MASTER);
    const envelope = await keystore.seal(Buffer.from("secret"), AAD);
    await expect(
      keystore.open(envelope, "0x1111111111111111111111111111111111111111"),
    ).rejects.toThrow(KeystoreIntegrityError);
  });

  it("detects tampering of every envelope field", async () => {
    const keystore = new Keystore(MASTER);
    const envelope = await keystore.seal(Buffer.from("secret"), AAD);
    const parts = envelope.split(":");
    for (let i = 1; i < parts.length; i += 1) {
      const tampered = [...parts];
      const original = Buffer.from(tampered[i] ?? "", "base64");
      if (original.length === 0) {
        continue;
      }
      original[0] = (original[0] ?? 0) ^ 0xff;
      tampered[i] = original.toString("base64");
      await expect(keystore.open(tampered.join(":"), AAD)).rejects.toThrow(KeystoreIntegrityError);
    }
  });

  it("rejects malformed and unknown-version envelopes", async () => {
    const keystore = new Keystore(MASTER);
    await expect(keystore.open("not-an-envelope", AAD)).rejects.toThrow(KeystoreIntegrityError);
    const envelope = await keystore.seal(Buffer.from("secret"), AAD);
    const v9 = envelope.replace(/^v1:/, "v9:");
    await expect(keystore.open(v9, AAD)).rejects.toThrow(/version/);
  });
});
