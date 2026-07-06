import { toAddress } from "@bot/domain";
import { describe, expect, it } from "vitest";
import { computeAnalytics } from "./analytics";
import type { TradeHistoryRecord } from "./trade-history";

const PEPE = toAddress("0x1111111111111111111111111111111111111111");
const DOGE = toAddress("0x2222222222222222222222222222222222222222");

const DAY_1 = Date.UTC(2026, 0, 1, 12, 0, 0);
const DAY_2 = Date.UTC(2026, 0, 2, 12, 0, 0);

function trade(
  partial: Partial<TradeHistoryRecord> & Pick<TradeHistoryRecord, "id">,
): TradeHistoryRecord {
  return {
    chainId: 8453,
    token: PEPE,
    txHash: `0x${partial.id.repeat(64).slice(0, 64)}`,
    simulated: false,
    amountIn: { raw: 0n, decimals: 18 },
    amountOut: { raw: 0n, decimals: 18 },
    side: "buy" as const,
    occurredAt: DAY_1,
    ...partial,
  };
}

describe("computeAnalytics", () => {
  it("computes a winning and a losing round trip", async () => {
    const records: TradeHistoryRecord[] = [
      trade({
        id: "1",
        side: "buy",
        token: PEPE,
        simulated: false,
        occurredAt: DAY_1,
        amountIn: { raw: 1_000_000_000_000_000_000n, decimals: 18 }, // 1 WETH in
        amountOut: { raw: 1_000_000n, decimals: 18 }, // PEPE out
      }),
      trade({
        id: "2",
        side: "sell",
        token: PEPE,
        simulated: false,
        occurredAt: DAY_1,
        amountIn: { raw: 1_000_000n, decimals: 18 }, // PEPE in
        amountOut: { raw: 1_500_000_000_000_000_000n, decimals: 18 }, // 1.5 WETH out
      }),
      trade({
        id: "3",
        side: "buy",
        token: DOGE,
        simulated: true,
        occurredAt: DAY_2,
        amountIn: { raw: 2_000_000_000_000_000_000n, decimals: 18 }, // 2 WETH in
        amountOut: { raw: 2_000_000n, decimals: 18 },
      }),
      trade({
        id: "4",
        side: "sell",
        token: DOGE,
        simulated: true,
        occurredAt: DAY_2,
        amountIn: { raw: 2_000_000n, decimals: 18 },
        amountOut: { raw: 1_000_000_000_000_000_000n, decimals: 18 }, // 1 WETH out
      }),
    ];

    const summary = await computeAnalytics(records);

    expect(summary.totalTrades).toBe(4);
    expect(summary.totalBuys).toBe(2);
    expect(summary.totalSells).toBe(2);
    expect(summary.winRate).toBeCloseTo(0.5);
    expect(summary.totalRealizedPnl).toBe("-500000000000000000");
    expect(summary.totalDeployed).toBe("3000000000000000000");
    expect(summary.roiPct).toBeCloseTo(-16.66, 1);
    expect(summary.pnlByToken).toEqual(
      expect.arrayContaining([
        { token: PEPE, realizedPnl: "500000000000000000" },
        { token: DOGE, realizedPnl: "-1000000000000000000" },
      ]),
    );
    expect(summary.pnlByDay).toEqual([
      { date: "2026-01-01", realizedPnl: "500000000000000000" },
      { date: "2026-01-02", realizedPnl: "-1000000000000000000" },
    ]);
    expect(summary.real).toEqual({ trades: 2, realizedPnl: "500000000000000000" });
    expect(summary.simulated).toEqual({ trades: 2, realizedPnl: "-1000000000000000000" });
  });

  it("reports zeros for an empty log", async () => {
    const summary = await computeAnalytics([]);
    expect(summary).toMatchObject({
      totalTrades: 0,
      winRate: 0,
      roiPct: 0,
      totalRealizedPnl: "0",
      totalDeployed: "0",
      pnlByToken: [],
      pnlByDay: [],
    });
  });
});
