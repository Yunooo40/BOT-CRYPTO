import { LiveRefresh } from "@/components/LiveRefresh";
import { pnlClass, StatTile, pnlTone } from "@/components/StatTile";
import { getPositions } from "@/lib/api-client";
import { getSessionToken } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatTokenAmount, formatWeth, shortenAddress } from "@/lib/format";

export default async function PositionsPage() {
  const [positions, token] = await Promise.all([getPositions(), getSessionToken()]);

  const totalUnrealized = positions.reduce(
    (sum, position) =>
      sum + (position.unrealizedPnl === null ? 0n : BigInt(position.unrealizedPnl)),
    0n,
  );
  const totalUnrealizedStr = totalUnrealized.toString();

  return (
    <div>
      {token !== undefined ? (
        <LiveRefresh
          token={token}
          types={["trade.executed"]}
          wsUrl={env.NEXT_PUBLIC_API_GATEWAY_WS_URL}
        />
      ) : null}
      <h1>Positions ouvertes</h1>

      <div className="stat-grid">
        <StatTile label="Positions ouvertes" value={String(positions.length)} />
        <StatTile
          label="PnL non réalisé (WETH)"
          value={formatWeth(totalUnrealizedStr)}
          tone={pnlTone(totalUnrealizedStr)}
        />
      </div>

      {positions.length === 0 ? (
        <p className="empty">Aucune position ouverte.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Montant</th>
              <th>Coût (WETH)</th>
              <th>PnL réalisé</th>
              <th>PnL non réalisé</th>
              <th>Ouverte le</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <tr key={position.id}>
                <td>
                  {shortenAddress(position.token)}
                  {position.simulated ? " (paper)" : ""}
                </td>
                {/* Memecoins on Base are 18-decimal by convention; the position
                    record itself does not carry the traded token's decimals. */}
                <td>{formatTokenAmount(position.amount, 18)}</td>
                <td>{formatWeth(position.costBasis)}</td>
                <td className={pnlClass(position.realizedPnl)}>
                  {formatWeth(position.realizedPnl)}
                </td>
                <td
                  className={
                    position.unrealizedPnl === null ? "muted" : pnlClass(position.unrealizedPnl)
                  }
                >
                  {position.unrealizedPnl === null ? "—" : formatWeth(position.unrealizedPnl)}
                </td>
                <td>{new Date(position.openedAt).toLocaleString("fr-FR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
