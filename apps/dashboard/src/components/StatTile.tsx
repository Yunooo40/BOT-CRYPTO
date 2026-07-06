interface StatTileProps {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
}

export function StatTile({ label, value, tone = "neutral" }: StatTileProps) {
  const toneClass = tone === "neutral" ? "" : tone === "positive" ? "pnl-positive" : "pnl-negative";
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className={`value ${toneClass}`}>{value}</div>
    </div>
  );
}

export function pnlTone(raw: string): "positive" | "negative" | "neutral" {
  const value = BigInt(raw);
  return value > 0n ? "positive" : value < 0n ? "negative" : "neutral";
}

export function pnlClass(raw: string): string {
  const tone = pnlTone(raw);
  return tone === "neutral" ? "" : tone === "positive" ? "pnl-positive" : "pnl-negative";
}
