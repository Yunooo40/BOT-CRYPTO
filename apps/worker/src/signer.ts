import { asHex } from "@bot/dex-adapters";
import type { Address, ChainId } from "@bot/domain";
import type { Signer } from "@bot/engine-core";
import type { Hex, PublicClient, TransactionSerializable } from "viem";

/**
 * The subset of a viem `PublicClient` the signer needs: read the pending nonce,
 * price the fees, size the gas, broadcast the signed tx and await its receipt.
 * Declared structurally so tests can hand in a plain mock.
 */
export type SignerClient = Pick<
  PublicClient,
  | "getTransactionCount"
  | "estimateFeesPerGas"
  | "estimateGas"
  | "sendRawTransaction"
  | "waitForTransactionReceipt"
>;

/**
 * The only capability the signer borrows from the Wallet Service (M4): turn an
 * unsigned EIP-1559 transaction into a signed, serialized one. Structural so
 * `WalletService` satisfies it without the worker depending on its concretes.
 */
export interface TxSigner {
  signTransaction(walletId: string, transaction: TransactionSerializable): Promise<Hex>;
}

export interface WalletSignerOptions {
  signer: TxSigner;
  /** Wallet Service id whose key signs — the key itself never reaches here. */
  walletId: string;
  /** The wallet's public address (fetched from the Wallet Service at wiring). */
  address: Address;
  client: SignerClient;
  chainId: ChainId;
}

/**
 * Bridges the Wallet Service (which signs) and a viem client (which broadcasts)
 * into the engine's `Signer` port (which wants `sendTransaction` → hash +
 * `waitForSuccess`). This is the missing seam for live execution: the engine's
 * `LiveExecutor` builds the swap/approve calldata and calls this; here we fill
 * in nonce/gas/fees, sign via M4, and put the raw tx on-chain.
 *
 * A private key is never in this module — signing stays inside the Wallet
 * Service, which decrypts, signs and zeroizes internally.
 *
 * One in-flight tx at a time per wallet (the engine already serializes intents
 * per wallet in M7); the pending-nonce read is correct under that assumption.
 */
export class WalletServiceSigner implements Signer {
  readonly address: Address;
  readonly #signer: TxSigner;
  readonly #walletId: string;
  readonly #client: SignerClient;
  readonly #chainId: ChainId;

  constructor(options: WalletSignerOptions) {
    this.address = options.address;
    this.#signer = options.signer;
    this.#walletId = options.walletId;
    this.#client = options.client;
    this.#chainId = options.chainId;
  }

  async sendTransaction(tx: {
    to: Address;
    data: `0x${string}`;
    value: bigint;
  }): Promise<`0x${string}`> {
    const from = asHex(this.address);
    const to = asHex(tx.to);

    // Pending nonce + current fees + a gas estimate for THIS call. Fetched
    // together; the engine runs one tx at a time per wallet so the pending
    // nonce won't race with a sibling send.
    const [nonce, fees, gas] = await Promise.all([
      this.#client.getTransactionCount({ address: from, blockTag: "pending" }),
      this.#client.estimateFeesPerGas(),
      this.#client.estimateGas({ account: from, to, data: tx.data, value: tx.value }),
    ]);

    const serializable: TransactionSerializable = {
      type: "eip1559",
      chainId: this.#chainId,
      nonce,
      to,
      value: tx.value,
      data: tx.data,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };

    const serializedTransaction = await this.#signer.signTransaction(this.#walletId, serializable);
    return this.#client.sendRawTransaction({ serializedTransaction });
  }

  async waitForSuccess(hash: `0x${string}`): Promise<boolean> {
    const receipt = await this.#client.waitForTransactionReceipt({ hash });
    return receipt.status === "success";
  }
}
