import { LiveRefresh } from "@/components/LiveRefresh";
import { pnlClass, StatTile, pnlTone } from "@/components/StatTile";
import { getAnalyticsSummary } from "@/lib/api-client";
import { getSessionToken } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatPct, formatWeth, formatWinRate, shortenAddress } from "@/lib/format";

export default async function AnalyticsPage() {
  const [summary, token] = await Promise.all([getAnalyticsSummary(), getSessionToken()]);

  const maxAbsDay = Math.max(
    1,
    ...summary.pnlByDay.map((day) => Math.abs(Number(day.realizedPnl))),
  );

  return (
    <div>
      {token !== undefined ? (
        <LiveRefresh
          token={token}
          types={["trade.executed"]}
          wsUrl={env.NEXT_PUBLIC_API_GATEWAY_WS_URL}
        />
      ) : null}
      <h1>Analytics</h1>

      <div className="stat-grid">
        <StatTile
          label="PnL réalisé (WETH)"
          value={formatWeth(summary.totalRealizedPnl)}
          tone={pnlTone(summary.totalRealizedPnl)}
        />
        <StatTile
          label="ROI"
          value={formatPct(summary.roiPct)}
          tone={summary.roiPct > 0 ? "positive" : summary.roiPct < 0 ? "negative" : "neutral"}
        />
        <StatTile label="Win rate" value={formatWinRate(summary.winRate)} />
        <StatTile label="Trades" value={String(summary.totalTrades)} />
      </div>

      <section className="section">
        <h2>PnL par jour (WETH)</h2>
        {summary.pnlByDay.length === 0 ? (
          <p className="empty">Pas encore assez de trades clôturés.</p>
        ) : (
          <>
            <div className="bar-chart">
              {summary.pnlByDay.map((day) => {
                const value = Number(day.realizedPnl);
                const heightPct = (Math.abs(value) / maxAbsDay) * 100;
                return (
                  <div
                    key={day.date}
                    className="bar-col"
                    title={`${day.date}: ${formatWeth(day.realizedPnl)} WETH`}
                  >
                    <div
                      className={`bar ${value >= 0 ? "positive" : "negative"}`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <table>
              <thead>
                <tr>
                  <th>Jour</th>
                  <th>PnL réalisé (WETH)</th>
                </tr>
              </thead>
              <tbody>
                {summary.pnlByDay.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td className={pnlClass(day.realizedPnl)}>{formatWeth(day.realizedPnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="section">
        <h2>PnL par token</h2>
        {summary.pnlByToken.length === 0 ? (
          <p className="empty">Pas encore assez de trades clôturés.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>PnL réalisé (WETH)</th>
              </tr>
            </thead>
            <tbody>
              {summary.pnlByToken.map((entry) => (
                <tr key={entry.token}>
                  <td>{shortenAddress(entry.token)}</td>
                  <td className={pnlClass(entry.realizedPnl)}>{formatWeth(entry.realizedPnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <h2>Réel vs paper trading</h2>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Trades</th>
              <th>PnL réalisé (WETH)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Réel</td>
              <td>{summary.real.trades}</td>
              <td className={pnlClass(summary.real.realizedPnl)}>
                {formatWeth(summary.real.realizedPnl)}
              </td>
            </tr>
            <tr>
              <td>Paper</td>
              <td>{summary.simulated.trades}</td>
              <td className={pnlClass(summary.simulated.realizedPnl)}>
                {formatWeth(summary.simulated.realizedPnl)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
