import { BASE_USDC, BASE_WETH, createDexAdapters } from "@bot/dex-adapters";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { describe, expect, it } from "vitest";
import { ShieldAnalyzer } from "./analyzer";

/**
 * Opt-in against real Base state (anvil fork or live RPC):
 *
 *   BASE_FORK_RPC_URL=... pnpm --filter @bot/shield-core test
 *
 * Assesses an established token (USDC) and expects a non-danger verdict with
 * every factor populated — a smoke test that the detectors read real chain
 * state coherently, not a correctness proof of the heuristics.
 */
const FORK_URL = process.env["BASE_FORK_RPC_URL"];

describe.skipIf(FORK_URL === undefined || FORK_URL === "")("shield against real Base state", () => {
  it("assesses an established token without flagging it as danger", async () => {
    const client = createPublicClient({
      chain: base,
      transport: http(FORK_URL ?? "", { timeout: 20_000 }),
    });
    const v3 = createDexAdapters(client).get("uniswap-v3");
    const pool = await v3?.getPool({ tokenA: BASE_WETH, tokenB: BASE_USDC, feeTier: 500 });
    const analyzer = new ShieldAnalyzer({ client });
    const risk = await analyzer.assess({
      token: BASE_USDC,
      quoteToken: BASE_WETH,
      ...(pool !== undefined ? { pool } : {}),
    });
    expect(risk.factors).toHaveLength(11);
    expect(risk.verdict).not.toBe("danger");
  }, 60_000);
});
