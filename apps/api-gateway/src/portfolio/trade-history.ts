import type { Address, ChainId, Trade, TradeSide } from "@bot/domain";

/**
 * The gateway's own trade log (M13), one row per settled `trade.executed`.
 * Built by `PortfolioIngestor` — see `db/schema.ts` for why this is not the
 * Trading Engine's table.
 */
export interface TradeHistoryRecord {
  id: string;
  chainId: ChainId;
  side: TradeSide;
  token: Address;
  amountIn: { raw: bigint; decimals: number };
  amountOut: { raw: bigint; decimals: number };
  txHash: string;
  simulated: boolean;
  occurredAt: number;
}

export function tradeHistoryRecordOf(trade: Trade, occurredAt: number): TradeHistoryRecord {
  return {
    id: trade.id,
    chainId: trade.chainId,
    side: trade.side,
    token: trade.token,
    amountIn: { raw: trade.amountIn.raw, decimals: trade.amountIn.decimals },
    amountOut: { raw: trade.amountOut.raw, decimals: trade.amountOut.decimals },
    txHash: trade.txHash,
    simulated: trade.simulated,
    occurredAt,
  };
}

export interface TradeHistoryPage {
  items: TradeHistoryRecord[];
  /** Opaque cursor for the next page; absent once the log is exhausted. */
  nextCursor?: string;
}

export interface TradeHistoryQuery {
  limit: number;
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor?: string;
}

export interface TradeHistoryRepository {
  /** Idempotent: a redelivered trade id is a no-op, not a duplicate row. */
  append(record: TradeHistoryRecord): Promise<void>;
  /** Newest first. */
  list(query: TradeHistoryQuery): Promise<TradeHistoryPage>;
  /** Every record, oldest first — analytics folds over the full log. */
  listAll(): Promise<TradeHistoryRecord[]>;
}

interface Cursor {
  occurredAt: number;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value: string): Cursor | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Cursor).occurredAt === "number" &&
      typeof (parsed as Cursor).id === "string"
    ) {
      return parsed as Cursor;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
