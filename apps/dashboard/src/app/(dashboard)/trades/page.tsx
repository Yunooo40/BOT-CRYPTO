import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getTrades } from "@/lib/api-client";
import { getSessionToken } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatTokenAmount, shortenAddress } from "@/lib/format";

interface TradesPageProps {
  searchParams: Promise<{ cursor?: string }>;
}

export default async function TradesPage({ searchParams }: TradesPageProps) {
  const { cursor } = await searchParams;
  const [page, token] = await Promise.all([getTrades(cursor), getSessionToken()]);

  return (
    <div>
      {token !== undefined ? (
        <LiveRefresh
          token={token}
          types={["trade.executed"]}
          wsUrl={env.NEXT_PUBLIC_API_GATEWAY_WS_URL}
        />
      ) : null}
      <h1>Historique des trades</h1>

      {page.items.length === 0 ? (
        <p className="empty">Aucun trade pour l&rsquo;instant.</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Sens</th>
                <th>Token</th>
                <th>Entrée</th>
                <th>Sortie</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((trade) => (
                <tr key={trade.id}>
                  <td>{new Date(trade.occurredAt).toLocaleString("fr-FR")}</td>
                  <td>
                    {trade.side === "buy" ? "Achat" : "Vente"}
                    {trade.simulated ? " (paper)" : ""}
                  </td>
                  <td>{shortenAddress(trade.token)}</td>
                  <td>{formatTokenAmount(trade.amountIn, trade.amountInDecimals)}</td>
                  <td>{formatTokenAmount(trade.amountOut, trade.amountOutDecimals)}</td>
                  <td>
                    <a
                      href={`https://basescan.org/tx/${trade.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortenAddress(trade.txHash)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {page.nextCursor !== undefined ? (
            <p className="pagination">
              <Link href={`/trades?cursor=${encodeURIComponent(page.nextCursor)}`}>
                Page suivante →
              </Link>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
