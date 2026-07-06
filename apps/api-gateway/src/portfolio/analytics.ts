import type { Trade } from "@bot/domain";
import { applyTrade, InMemoryPositionStore } from "@bot/engine-core";
import type { TradeHistoryRecord } from "./trade-history";

export interface AnalyticsSummary {
  totalTrades: number;
  totalBuys: number;
  totalSells: number;
  /** Share of sells with a positive realized delta; 0 when there are no sells yet. */
  winRate: number;
  /** In the quote asset's (WETH) base units. */
  totalRealizedPnl: string;
  /** Sum of every buy's quote spent — the ROI denominator. */
  totalDeployed: string;
  /** `totalRealizedPnl / totalDeployed * 100`; 0 when nothing has been deployed. */
  roiPct: number;
  pnlByToken: Array<{ token: string; realizedPnl: string }>;
  /** UTC calendar day (`YYYY-MM-DD`), chronological. */
  pnlByDay: Array<{ date: string; realizedPnl: string }>;
  real: { trades: number; realizedPnl: string };
  simulated: { trades: number; realizedPnl: string };
}

function toTrade(record: TradeHistoryRecord): Trade {
  return {
    id: record.id,
    chainId: record.chainId,
    side: record.side,
    token: record.token,
    amountIn: record.amountIn,
    amountOut: record.amountOut,
    txHash: record.txHash,
    simulated: record.simulated,
  };
}

function dayKey(occurredAt: number): string {
  return new Date(occurredAt).toISOString().slice(0, 10);
}

/**
 * Re-folds the trade log through the Trading Engine's own `applyTrade` to
 * recover realized PnL per sell — the position book alone can't answer this
 * because a fully-closed position is deleted from it (see `positions.ts`).
 * Records must be chronological (oldest first), matching `listAll()`.
 */
export async function computeAnalytics(records: TradeHistoryRecord[]): Promise<AnalyticsSummary> {
  const store = new InMemoryPositionStore();

  let totalBuys = 0;
  let totalSells = 0;
  let wins = 0;
  let totalRealizedPnl = 0n;
  let totalDeployed = 0n;
  const pnlByToken = new Map<string, bigint>();
  const pnlByDay = new Map<string, bigint>();
  const real = { trades: 0, realizedPnl: 0n };
  const simulated = { trades: 0, realizedPnl: 0n };

  for (const record of records) {
    const bucket = record.simulated ? simulated : real;
    bucket.trades += 1;
    if (record.side === "buy") {
      totalBuys += 1;
      totalDeployed += record.amountIn.raw;
    } else {
      totalSells += 1;
    }

    const before = await store.get(record.chainId, record.token, record.simulated);
    const result = await applyTrade(store, toTrade(record), () => record.occurredAt);
    if (record.side === "sell") {
      const delta = (result?.realizedPnl ?? 0n) - (before?.realizedPnl ?? 0n);
      totalRealizedPnl += delta;
      bucket.realizedPnl += delta;
      if (delta > 0n) {
        wins += 1;
      }
      pnlByToken.set(record.token, (pnlByToken.get(record.token) ?? 0n) + delta);
      const day = dayKey(record.occurredAt);
      pnlByDay.set(day, (pnlByDay.get(day) ?? 0n) + delta);
    }
  }

  const roiPct =
    totalDeployed > 0n ? Number((totalRealizedPnl * 10_000n) / totalDeployed) / 100 : 0;

  return {
    totalTrades: records.length,
    totalBuys,
    totalSells,
    winRate: totalSells > 0 ? wins / totalSells : 0,
    totalRealizedPnl: totalRealizedPnl.toString(),
    totalDeployed: totalDeployed.toString(),
    roiPct,
    pnlByToken: [...pnlByToken.entries()].map(([token, realizedPnl]) => ({
      token,
      realizedPnl: realizedPnl.toString(),
    })),
    pnlByDay: [...pnlByDay.entries()].map(([date, realizedPnl]) => ({
      date,
      realizedPnl: realizedPnl.toString(),
    })),
    real: { trades: real.trades, realizedPnl: real.realizedPnl.toString() },
    simulated: { trades: simulated.trades, realizedPnl: simulated.realizedPnl.toString() },
  };
}
