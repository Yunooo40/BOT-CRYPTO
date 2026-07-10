import { asHex, type DexAdapter } from "@bot/dex-adapters";
import type { Address, Trade } from "@bot/domain";
import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { createLogger, type Logger } from "@bot/logger";
import { TradeRevertedError } from "./errors";
import type { ExecuteRequest, Executor, Router, Signer } from "./ports";
import { minOut, quoteIntent, raw, tokenInFor, tokenOutFor } from "./quote";

/** Read surface the live executor needs: allowance check + swap receipt. */
export type ExecutorClient = Pick<PublicClient, "readContract" | "getTransactionReceipt">;

export interface LiveExecutorOptions {
  router: Router;
  signer: Signer;
  client: ExecutorClient;
  logger?: Logger;
}

const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Sum the `tokenOut` base units actually delivered to `recipient` in a mined
 * swap, read from the receipt's ERC-20 `Transfer` logs. This is the *realized*
 * fill — net of any transfer tax — not the quote's estimate or the router's
 * `amountOutMin`, so the position book (and the exit levels priced off it) match
 * what the wallet truly received.
 */
export function realizedAmountOut(
  receipt: TransactionReceipt,
  tokenOut: Address,
  recipient: Address,
): bigint {
  const token = asHex(tokenOut).toLowerCase();
  const to = asHex(recipient).toLowerCase();
  let total = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== token) continue;
    let args: { to: string; value: bigint };
    try {
      ({ args } = decodeEventLog({
        abi: erc20Abi,
        eventName: "Transfer",
        data: log.data,
        topics: log.topics,
      }));
    } catch {
      continue; // not a Transfer on this token (e.g. Approval) — ignore
    }
    if (args.to.toLowerCase() !== to) continue;
    total += args.value;
  }
  return total;
}

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
  readonly #logger: Logger;

  constructor(options: LiveExecutorOptions) {
    this.#router = options.router;
    this.#signer = options.signer;
    this.#client = options.client;
    this.#logger = options.logger ?? createLogger({ name: "live-executor" });
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

    // Record what the wallet *actually* received, read from the swap receipt's
    // Transfer logs — not the router's `amountOutMin` floor, which understates
    // the fill and would inflate the entry price the exits are calibrated on.
    // If no Transfer to us is observed (unusual token / non-standard event),
    // fall back to the slippage floor the mined tx already guaranteed.
    const floor = minOut(quote, intent.maxSlippageBps);
    const receipt = await this.#client.getTransactionReceipt({ hash });
    const tokenOut = tokenOutFor(intent, pool);
    const received = realizedAmountOut(receipt, tokenOut, this.#signer.address);
    const amountOut = received > 0n ? received : floor;
    if (received === 0n) {
      this.#logger.warn(
        { intentId, token: intent.token, txHash: hash, floor: floor.toString() },
        "no Transfer to wallet found in swap receipt; falling back to slippage floor for amountOut",
      );
    }

    return {
      id: intentId,
      chainId: intent.chainId,
      side: intent.side,
      token: intent.token,
      amountIn: intent.amountIn,
      amountOut: raw(amountOut),
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
