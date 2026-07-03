import { randomUUID } from "node:crypto";
import { toAddress, type Address } from "@bot/domain";
import { ValidationError } from "@bot/errors";
import type { Hex, SignableMessage, TransactionSerializable, TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { KeystoreIntegrityError, WalletNotFoundError } from "./errors";
import { Keystore } from "./keystore";
import type { WalletRecord, WalletRepository } from "./repository";

/** Public view of a wallet — everything except the encrypted key material. */
export interface WalletInfo {
  id: string;
  tenantId: string | null;
  label: string;
  address: Address;
  createdAt: Date;
}

export interface WalletServiceOptions {
  repository: WalletRepository;
  /** `WALLET_MASTER_KEY` from `@bot/config`. */
  masterKey: string;
  /** Owner of the wallets created by this instance. Null: single-owner setup. */
  tenantId?: string | null;
  now?: () => Date;
  newId?: () => string;
}

const PRIVATE_KEY_REGEX = /^0x[0-9a-fA-F]{64}$/;

function toInfo(record: WalletRecord): WalletInfo {
  return {
    id: record.id,
    tenantId: record.tenantId,
    label: record.label,
    address: record.address,
    createdAt: record.createdAt,
  };
}

/**
 * The only door to private keys. Keys are generated or imported here, stored
 * as AES-256-GCM envelopes, and only ever decrypted for the duration of one
 * signing call — the buffer is zeroized right after. No API returns, logs or
 * exports a clear key.
 *
 * (Honest limitation: the hex string handed to viem for the actual signature
 * is a V8 string and cannot be zeroized; its lifetime is kept minimal.)
 */
export class WalletService {
  readonly #repository: WalletRepository;
  readonly #keystore: Keystore;
  readonly #tenantId: string | null;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: WalletServiceOptions) {
    this.#repository = options.repository;
    this.#keystore = new Keystore(options.masterKey);
    this.#tenantId = options.tenantId ?? null;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  /** Generate a fresh wallet. The private key never leaves this method. */
  async createWallet(label: string): Promise<WalletInfo> {
    return this.#store(generatePrivateKey(), label);
  }

  /** Import an existing private key (0x + 64 hex). It is encrypted immediately. */
  async importWallet(privateKey: string, label: string): Promise<WalletInfo> {
    if (!PRIVATE_KEY_REGEX.test(privateKey)) {
      // Deliberately context-free: never echo anything key-shaped anywhere.
      throw new ValidationError("Invalid private key: expected 0x-prefixed 32-byte hex");
    }
    return this.#store(privateKey as Hex, label);
  }

  async getWallet(id: string): Promise<WalletInfo> {
    return toInfo(await this.#record(id));
  }

  async findByAddress(address: Address): Promise<WalletInfo | undefined> {
    const record = await this.#repository.findByAddress(address);
    return record === undefined ? undefined : toInfo(record);
  }

  async listWallets(): Promise<WalletInfo[]> {
    return (await this.#repository.list()).map(toInfo);
  }

  async signTransaction(id: string, transaction: TransactionSerializable): Promise<Hex> {
    return this.#withAccount(id, (account) => account.signTransaction(transaction));
  }

  async signMessage(id: string, message: SignableMessage): Promise<Hex> {
    return this.#withAccount(id, (account) => account.signMessage({ message }));
  }

  async signTypedData(id: string, typedData: TypedDataDefinition): Promise<Hex> {
    return this.#withAccount(id, (account) => account.signTypedData(typedData));
  }

  async #store(privateKey: Hex, label: string): Promise<WalletInfo> {
    const trimmed = label.trim();
    if (trimmed.length === 0 || trimmed.length > 64) {
      throw new ValidationError("Wallet label must be 1–64 characters", {
        context: { length: trimmed.length },
      });
    }
    const address = toAddress(privateKeyToAccount(privateKey).address);
    const encryptedKey = await this.#keystore.seal(
      Buffer.from(privateKey.slice(2), "hex"),
      address,
    );
    const record: WalletRecord = {
      id: this.#newId(),
      tenantId: this.#tenantId,
      label: trimmed,
      address,
      encryptedKey,
      createdAt: this.#now(),
    };
    await this.#repository.insert(record);
    return toInfo(record);
  }

  async #record(id: string): Promise<WalletRecord> {
    const record = await this.#repository.findById(id);
    if (record === undefined) {
      throw new WalletNotFoundError(`No wallet with id ${id}`, { context: { id } });
    }
    return record;
  }

  /**
   * Decrypt, act, zeroize. The clear key exists only inside this scope; the
   * recovered account must match the stored address (defence in depth on top
   * of the envelope's AAD binding).
   */
  async #withAccount<T>(
    id: string,
    action: (account: PrivateKeyAccount) => Promise<T>,
  ): Promise<T> {
    const record = await this.#record(id);
    const keyBuffer = await this.#keystore.open(record.encryptedKey, record.address);
    try {
      const account = privateKeyToAccount(`0x${keyBuffer.toString("hex")}`);
      if (account.address.toLowerCase() !== record.address) {
        throw new KeystoreIntegrityError("Decrypted key does not match the wallet address", {
          context: { id, address: record.address },
        });
      }
      return await action(account);
    } finally {
      keyBuffer.fill(0);
    }
  }
}
