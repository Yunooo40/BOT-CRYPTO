import { ValidationError } from "@bot/errors";
import {
  parseTransaction,
  recoverMessageAddress,
  recoverTypedDataAddress,
  type TransactionSerializable,
} from "viem";
import { describe, expect, it } from "vitest";
import { WalletNotFoundError } from "./errors";
import { InMemoryWalletRepository } from "./in-memory";
import { WalletService } from "./wallets";

const MASTER = "test-master-key-with-enough-length";

// anvil's well-known dev account #0 — a public test vector, not a secret.
const KNOWN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KNOWN_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

function makeService() {
  const repository = new InMemoryWalletRepository();
  const service = new WalletService({ repository, masterKey: MASTER });
  return { service, repository };
}

describe("WalletService.createWallet / importWallet", () => {
  it("creates a wallet and never exposes key material", async () => {
    const { service } = makeService();
    const wallet = await service.createWallet("sniper-1");
    expect(wallet.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(wallet.label).toBe("sniper-1");
    expect(wallet.tenantId).toBeNull();
    expect(Object.keys(wallet).sort()).toEqual(["address", "createdAt", "id", "label", "tenantId"]);
  });

  it("imports a known key and recovers its canonical address", async () => {
    const { service } = makeService();
    const wallet = await service.importWallet(KNOWN_KEY, "anvil-0");
    expect(wallet.address).toBe(KNOWN_ADDRESS);
  });

  it("stores only an encrypted envelope", async () => {
    const { service, repository } = makeService();
    const wallet = await service.importWallet(KNOWN_KEY, "anvil-0");
    const record = await repository.findById(wallet.id);
    expect(record?.encryptedKey.startsWith("v1:")).toBe(true);
    expect(record?.encryptedKey).not.toContain(KNOWN_KEY.slice(2));
  });

  it("rejects malformed keys and labels", async () => {
    const { service } = makeService();
    await expect(service.importWallet("0x1234", "bad")).rejects.toThrow(ValidationError);
    await expect(service.createWallet("")).rejects.toThrow(ValidationError);
    await expect(service.createWallet("x".repeat(65))).rejects.toThrow(ValidationError);
  });

  it("lists wallets and finds them by address", async () => {
    const { service } = makeService();
    const first = await service.createWallet("a");
    const second = await service.createWallet("b");
    const listed = await service.listWallets();
    expect(listed.map((wallet) => wallet.id)).toEqual([first.id, second.id]);
    await expect(service.findByAddress(second.address)).resolves.toMatchObject({
      id: second.id,
    });
  });
});

describe("WalletService signing", () => {
  it("signs a message that recovers to the wallet address", async () => {
    const { service } = makeService();
    const wallet = await service.importWallet(KNOWN_KEY, "anvil-0");
    const signature = await service.signMessage(wallet.id, "gm");
    const recovered = await recoverMessageAddress({ message: "gm", signature });
    expect(recovered.toLowerCase()).toBe(KNOWN_ADDRESS);
  });

  it("signs an EIP-1559 transaction for Base", async () => {
    const { service } = makeService();
    const wallet = await service.importWallet(KNOWN_KEY, "anvil-0");
    const transaction: TransactionSerializable = {
      chainId: 8453,
      type: "eip1559",
      to: "0x4200000000000000000000000000000000000006",
      value: 10n ** 15n,
      nonce: 0,
      gas: 21_000n,
      maxFeePerGas: 10n ** 8n,
      maxPriorityFeePerGas: 10n ** 6n,
    };
    const raw = await service.signTransaction(wallet.id, transaction);
    const parsed = parseTransaction(raw);
    expect(parsed.chainId).toBe(8453);
    expect(parsed.to?.toLowerCase()).toBe("0x4200000000000000000000000000000000000006");
    expect(parsed.value).toBe(10n ** 15n);
  });

  it("signs typed data that recovers to the wallet address", async () => {
    const { service } = makeService();
    const wallet = await service.importWallet(KNOWN_KEY, "anvil-0");
    const typedData = {
      domain: { name: "BotCrypto", version: "1", chainId: 8453 },
      types: { Order: [{ name: "amount", type: "uint256" }] },
      primaryType: "Order",
      message: { amount: 42n },
    } as const;
    const signature = await service.signTypedData(wallet.id, typedData);
    const recovered = await recoverTypedDataAddress({ ...typedData, signature });
    expect(recovered.toLowerCase()).toBe(KNOWN_ADDRESS);
  });

  it("throws WalletNotFoundError for an unknown id", async () => {
    const { service } = makeService();
    await expect(service.signMessage("nope", "gm")).rejects.toThrow(WalletNotFoundError);
  });
});
