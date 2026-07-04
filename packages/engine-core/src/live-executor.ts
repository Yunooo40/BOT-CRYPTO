import { asHex, type DexAdapter } from "@bot/dex-adapters";
import type { Address, Trade } from "@bot/domain";
import { encodeFunctionData, erc20Abi, type PublicClient } from "viem";
import { TradeRevertedError } from "./errors";
import type { ExecuteRequest, Executor, Router, Signer } from "./ports";
import { minOut, quoteIntent, raw, tokenInFor } from "./quote";

/** Read surface the live executor needs (allowance check). */
export type ExecutorClient = Pick<PublicClient, "readContract">;

export interface LiveExecutorOptions {
  router: Router;
  signer: Signer;
  client: ExecutorClient;
}

const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Live execution: quote → build swap calldata (M3) → approve the router for the
 * input token if the allowance is short → sign & send via the Signer (M4) →
 * wait for the receipt. Never touches a private key directly; that stays in the
 * Wallet Service behind the `Signer` port.
 *
 * One intent at a time per wallet — concurrent-nonce management is out of scope
 * for M7 (M8+).
 */
export class LiveExecutor implements Executor {
  readonly mode = "live" as const;
  readonly #router: Router;
  readonly #signer: Signer;
  readonly #client: ExecutorClient;

  constructor(options: LiveExecutorOptions) {
    this.#router = options.router;
    this.#signer = options.signer;
    this.#client = options.client;
  }

  async execute(request: ExecuteRequest): Promise<Trade> {
    const { intent, pool, intentId } = request;
    const adapter: DexAdapter = this.#router.adapterFor(pool);
    const tokenIn = tokenInFor(intent, pool);
    const quote = await quoteIntent(adapter, intent, pool);
    const expectedAmountOut = quote.amountOut;

    const call = adapter.buildSwapCalldata({
      pool,
      tokenIn,
      amountIn: intent.amountIn.raw,
      expectedAmountOut,
      slippageBps: intent.maxSlippageBps,
      recipient: this.#signer.address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 120),
    });

    await this.#ensureAllowance(tokenIn, call.to, intent.amountIn.raw);

    const hash = await this.#signer.sendTransaction(call);
    const ok = await this.#signer.waitForSuccess(hash);
    if (!ok) {
      throw new TradeRevertedError("Swap transaction reverted", {
        context: { intentId, token: intent.token, txHash: hash },
      });
    }
    // The router's amountOutMin already enforced slippage on-chain; a mined
    // success means at least `minOut` was received.
    return {
      id: intentId,
      chainId: intent.chainId,
      side: intent.side,
      token: intent.token,
      amountIn: intent.amountIn,
      amountOut: raw(minOut(quote, intent.maxSlippageBps)),
      txHash: hash,
      simulated: false,
    };
  }

  /** Approve the router for `spender` if the current allowance is insufficient. */
  async #ensureAllowance(token: Address, spender: Address, amount: bigint): Promise<void> {
    const allowance = await this.#client.readContract({
      address: asHex(token),
      abi: erc20Abi,
      functionName: "allowance",
      args: [asHex(this.#signer.address), asHex(spender)],
    });
    if (allowance >= amount) {
      return;
    }
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [asHex(spender), MAX_UINT256],
    });
    const hash = await this.#signer.sendTransaction({ to: token, data, value: 0n });
    const ok = await this.#signer.waitForSuccess(hash);
    if (!ok) {
      throw new TradeRevertedError("Approve transaction reverted", {
        context: { token, spender, txHash: hash },
      });
    }
  }
}
