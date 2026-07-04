import { asHex } from "@bot/dex-adapters";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { describe, expect, it } from "vitest";
import { defaultVenueSources } from "./sources";

/**
 * Opt-in integration against real Base state (anvil fork or live RPC):
 *
 *   BASE_FORK_RPC_URL=... pnpm --filter @bot/scanner-core test
 *
 * Scans a recent block window on each factory and checks that every real
 * PoolCreated/PairCreated log decodes into a valid domain Pool.
 */
const FORK_URL = process.env["BASE_FORK_RPC_URL"];

describe.skipIf(FORK_URL === undefined || FORK_URL === "")("scanner against real Base logs", () => {
  const client = createPublicClient({
    chain: base,
    transport: http(FORK_URL ?? "", { timeout: 20_000 }),
  });

  it("decodes real factory logs from a recent window on every venue", async () => {
    const head = await client.getBlockNumber();
    // ~30 min of Base blocks: enough for a few pool creations, cheap to scan.
    const fromBlock = head - 900n;
    for (const source of defaultVenueSources()) {
      const logs = await client.getLogs({
        address: asHex(source.factory),
        event: source.event,
        fromBlock,
        toBlock: head,
        strict: true,
      });
      for (const log of logs) {
        const pool = source.toPool((log as { args: Record<string, unknown> }).args, 8453);
        expect(pool).toBeDefined();
        expect(pool?.dex).toBe(source.dex);
        expect(pool?.address).toMatch(/^0x[0-9a-f]{40}$/);
      }
    }
  }, 60_000);
});
