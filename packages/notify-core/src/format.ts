import type { DomainEvent } from "@bot/events";
import type { NotificationMessage } from "./message";

/** Base explorer for links; Base mainnet by default. */
const EXPLORER = "https://basescan.org";

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/**
 * Map a domain event to a channel-agnostic notification, or `undefined` for
 * event types that aren't worth notifying on (e.g. every `pool.created`). The
 * severity drives routing; the fields carry the trade/risk details.
 */
export function formatEvent(event: DomainEvent): NotificationMessage | undefined {
  switch (event.type) {
    case "trade.executed": {
      const { trade } = event.payload;
      const tag = trade.simulated ? " (paper)" : "";
      return {
        title: `${trade.side === "buy" ? "Bought" : "Sold"} token${tag}`,
        body: `${trade.side.toUpperCase()} ${trade.token} settled.`,
        severity: "success",
        fields: [
          { label: "Token", value: trade.token },
          { label: "Amount in", value: trade.amountIn.raw.toString() },
          { label: "Amount out", value: trade.amountOut.raw.toString() },
          { label: "Tx", value: shortHash(trade.txHash) },
        ],
        link: `${EXPLORER}/tx/${trade.txHash}`,
        dedupeKey: `trade.executed:${trade.id}`,
      };
    }
    case "trade.failed": {
      const { intent, reason, retryable } = event.payload;
      return {
        title: `Trade failed${retryable ? " (will retry)" : ""}`,
        body: reason,
        severity: retryable ? "warning" : "critical",
        fields: [
          { label: "Side", value: intent.side },
          { label: "Token", value: intent.token },
        ],
        dedupeKey: `trade.failed:${event.correlationId}`,
      };
    }
    case "risk.assessed": {
      const { risk, token } = event.payload;
      if (risk.verdict !== "danger") {
        return undefined; // only surface the dangerous ones
      }
      return {
        title: "⚠️ Dangerous token flagged",
        body: `Risk score ${risk.score}/100 — verdict danger.`,
        severity: "critical",
        fields: [
          { label: "Token", value: token },
          {
            label: "Top factors",
            value: risk.factors
              .filter((f) => f.score >= 60)
              .slice(0, 3)
              .map((f) => `${f.detector} (${f.score})`)
              .join(", "),
          },
        ],
        dedupeKey: `risk.danger:${token}`,
      };
    }
    default:
      return undefined;
  }
}
