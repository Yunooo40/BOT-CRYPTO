import { DomainError } from "@bot/errors";

/** The realized output fell below the slippage-guarded minimum. Not retryable. */
export class SlippageError extends DomainError {
  override readonly code: string = "SLIPPAGE_EXCEEDED";
}

/** The swap transaction reverted or the receipt reported failure. Not retryable. */
export class TradeRevertedError extends DomainError {
  override readonly code: string = "TRADE_REVERTED";
}
