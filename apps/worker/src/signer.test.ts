import { toAddress } from "@bot/domain";
import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import { WalletServiceSigner, type SignerClient, type TxSigner } from "./signer.js";

const CHAIN_ID = 8453;
const WALLET = toAddress(getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
const TO = toAddress(getAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
const TX_HASH = `0x${"11".repeat(32)}` as const;

function mocks() {
  const txSigner: TxSigner = { signTransaction: vi.fn().mockResolvedValue("0xsigned") };
  const client = {
    getTransactionCount: vi.fn().mockResolvedValue(7),
    estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 100n, maxPriorityFeePerGas: 2n }),
    estimateGas: vi.fn().mockResolvedValue(21_000n),
    sendRawTransaction: vi.fn().mockResolvedValue(TX_HASH),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
  } as unknown as SignerClient;
  const signer = new WalletServiceSigner({
    signer: txSigner,
    walletId: "wallet-1",
    address: WALLET,
    client,
    chainId: CHAIN_ID,
  });
  return { txSigner, client, signer };
}

describe("WalletServiceSigner", () => {
  it("builds an EIP-1559 tx from the pending nonce, fees and gas, then broadcasts the signed raw tx", async () => {
    const { txSigner, client, signer } = mocks();

    const hash = await signer.sendTransaction({ to: TO, data: "0xdeadbeef", value: 5n });

    expect(hash).toBe(TX_HASH);
    expect(client.getTransactionCount).toHaveBeenCalledWith(
      expect.objectContaining({ blockTag: "pending" }),
    );
    expect(txSigner.signTransaction).toHaveBeenCalledWith(
      "wallet-1",
      expect.objectContaining({
        type: "eip1559",
        chainId: CHAIN_ID,
        nonce: 7,
        gas: 21_000n,
        maxFeePerGas: 100n,
        maxPriorityFeePerGas: 2n,
        value: 5n,
        data: "0xdeadbeef",
      }),
    );
    expect(client.sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: "0xsigned" });
  });

  it("never signs before it has a nonce, fees and a gas estimate", async () => {
    const { txSigner, client, signer } = mocks();
    await signer.sendTransaction({ to: TO, data: "0x", value: 0n });
    expect(client.estimateGas).toHaveBeenCalledOnce();
    expect(client.estimateFeesPerGas).toHaveBeenCalledOnce();
    expect(txSigner.signTransaction).toHaveBeenCalledOnce();
  });

  it("waitForSuccess maps a mined receipt to a boolean", async () => {
    const { client, signer } = mocks();
    expect(await signer.waitForSuccess(TX_HASH)).toBe(true);

    (client.waitForTransactionReceipt as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: "reverted",
    });
    expect(await signer.waitForSuccess(TX_HASH)).toBe(false);
  });
});
