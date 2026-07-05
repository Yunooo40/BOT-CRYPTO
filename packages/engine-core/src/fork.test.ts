import { BASE_USDC, BASE_WETH, createDexAdapters } from "@bot/dex-adapters";
import { tokenAmount, type TradeIntent } from "@bot/domain";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { describe, expect, it } from "vitest";
import { TradingEngine } from "./engine";
import { PaperExecutor } from "./paper-executor";
import { InMemoryPositionStore } from "./positions";
import { AdapterRouter } from "./router";

/**
 * Opt-in against real Base state (anvil fork or live RPC):
 *
 *   BASE_FORK_RPC_URL=... pnpm --filter @bot/engine-core test
 *
 * Paper-trades a real WETH→USDC quote — a real chain read, zero transactions —
 * and checks a position opens.
 */
const FORK_URL = process.env["BASE_FORK_RPC_URL"];

describe.skipIf(FORK_URL === undefined || FORK_URL === "")(
  "engine paper-trades real quotes",
  () => {
    it("opens a position from a real WETH→USDC quote without any transaction", async () => {
      const client = createPublicClient({
        chain: base,
        transport: http(FORK_URL ?? "", { timeout: 20_000 }),
      });
      const adapters = createDexAdapters(client);
      const pool = await adapters
        .get("uniswap-v3")
        ?.getPool({ tokenA: BASE_WETH, tokenB: BASE_USDC, feeTier: 500 });
      expect(pool).toBeDefined();
      const engine = new TradingEngine({
        executor: new PaperExecutor({ router: new AdapterRouter(adapters) }),
        positions: new InMemoryPositionStore(),
      });
      const intent: TradeIntent = {
        chainId: 8453,
        side: "buy",
        token: BASE_USDC,
        amountIn: tokenAmount(10n ** 17n, 18), // 0.1 WETH
        maxSlippageBps: 500,
        simulated: true,
      };
      const result = await engine.trade(intent, pool!, "fork-1");
      expect(result.status).toBe("executed");
      expect(result.trade?.amountOut.raw).toBeGreaterThan(0n);
      expect(result.position?.amount).toBeGreaterThan(0n);
    }, 60_000);
  },
);
