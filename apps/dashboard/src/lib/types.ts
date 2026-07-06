/**
 * Response shapes mirrored from `apps/api-gateway`'s portfolio controllers —
 * duplicated deliberately: apps never import each other (see CLAUDE.md), so
 * the REST contract is the only thing shared between them.
 */

export interface Position {
  id: string;
  chainId: number;
  token: string;
  simulated: boolean;
  amount: string;
  costBasis: string;
  realizedPnl: string;
  unrealizedPnl: string | null;
  openedAt: number;
  updatedAt: number;
}

export interface Trade {
  id: string;
  chainId: number;
  side: "buy" | "sell";
  token: string;
  amountIn: string;
  amountInDecimals: number;
  amountOut: string;
  amountOutDecimals: number;
  txHash: string;
  simulated: boolean;
  occurredAt: number;
}

export interface TradesPage {
  items: Trade[];
  nextCursor?: string;
}

export interface AnalyticsSummary {
  totalTrades: number;
  totalBuys: number;
  totalSells: number;
  winRate: number;
  totalRealizedPnl: string;
  totalDeployed: string;
  roiPct: number;
  pnlByToken: Array<{ token: string; realizedPnl: string }>;
  pnlByDay: Array<{ date: string; realizedPnl: string }>;
  real: { trades: number; realizedPnl: string };
  simulated: { trades: number; realizedPnl: string };
}
