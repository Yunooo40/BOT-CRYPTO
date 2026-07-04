import type { DexAdapter } from "@bot/dex-adapters";
import type { Trade } from "@bot/domain";
import type { ExecuteRequest, Executor, Router } from "./ports";
import { assertWithinSlippage, minOut, quoteIntent, raw } from "./quote";

export interface PaperExecutorOptions {
  router: Router;
}

/**
 * Paper trading: a real on-chain quote (via M3) but no transaction. The intent
 * flows through exactly the same path as live — quote, slippage floor — then
 * settles against the quote instead of the chain. `simulated: true`, a
 * deterministic `0xpaper…` hash. Native, first-class, zero risk.
 */
export class PaperExecutor implements Executor {
  readonly mode = "paper" as const;
  readonly #router: Router;

  constructor(options: PaperExecutorOptions) {
    this.#router = options.router;
  }

  async execute(request: ExecuteRequest): Promise<Trade> {
    const { intent, pool, intentId } = request;
    const adapter: DexAdapter = this.#router.adapterFor(pool);
    const quote = await quoteIntent(adapter, intent, pool);
    const floor = minOut(quote, intent.maxSlippageBps);
    // Paper still honours the guard: a trade the live path would reject for
    // slippage must fail on paper too, or the simulation lies.
    assertWithinSlippage(quote.amountOut, floor, intent.token);
    return {
      id: intentId,
      chainId: intent.chainId,
      side: intent.side,
      token: intent.token,
      amountIn: intent.amountIn,
      amountOut: raw(quote.amountOut),
      txHash: paperHash(intentId),
      simulated: true,
    };
  }
}

/** Deterministic pseudo-hash for a paper trade: `0xpaper` + intent id digest. */
function paperHash(intentId: string): `0x${string}` {
  let hash = 0;
  for (let i = 0; i < intentId.length; i += 1) {
    hash = (hash * 31 + intentId.charCodeAt(i)) >>> 0;
  }
  const suffix = hash.toString(16).padStart(8, "0");
  return `0x7061706572${"0".repeat(54)}${suffix}`.slice(0, 66) as `0x${string}`;
}
