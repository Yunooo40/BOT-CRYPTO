import type { Address, ChainId, Token } from "@bot/domain";
import type { ScannerClient } from "./ports";

/**
 * Read ERC-20 metadata defensively. Memecoins routinely ship broken metadata
 * (bytes32 symbols, reverting `name()`, absurd `decimals()`): every field
 * falls back instead of crashing the pipeline — the Shield will judge the
 * token, the scanner only reports it.
 */

const stringMetadataAbi = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

const bytes32MetadataAbi = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const decimalsAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

function bytes32ToString(value: string): string {
  return Buffer.from(value.slice(2), "hex").toString("utf8").replace(/\0+$/, "").trim();
}

async function readText(
  client: ScannerClient,
  address: `0x${string}`,
  fn: "symbol" | "name",
): Promise<string> {
  try {
    const value = await client.readContract({ address, abi: stringMetadataAbi, functionName: fn });
    return value.trim();
  } catch {
    try {
      const raw = await client.readContract({ address, abi: bytes32MetadataAbi, functionName: fn });
      return bytes32ToString(raw);
    } catch {
      return "";
    }
  }
}

export async function readTokenMetadata(
  client: ScannerClient,
  address: Address,
  chainId: ChainId,
): Promise<Token> {
  const hex = address as unknown as `0x${string}`;
  const [symbol, name, decimals] = await Promise.all([
    readText(client, hex, "symbol"),
    readText(client, hex, "name"),
    client
      .readContract({ address: hex, abi: decimalsAbi, functionName: "decimals" })
      .then((value) => Number(value))
      .catch(() => 18),
  ]);
  return {
    chainId,
    address,
    symbol: (symbol.length > 0 ? symbol : "???").slice(0, 32),
    name: name.slice(0, 128),
    decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18,
  };
}
