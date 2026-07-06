/** Renders a raw base-unit amount (decimal string, as the gateway sends bigints) as a decimal. */
export function formatTokenAmount(raw: string, decimals: number): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;
  const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return fractionStr.length > 0 ? `${sign}${whole}.${fractionStr}` : `${sign}${whole}`;
}

/** WETH (18 decimals) is the quote asset every PnL figure is denominated in. */
export function formatWeth(raw: string): string {
  return formatTokenAmount(raw, 18);
}

export function formatPct(value: number, fractionDigits = 2): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(fractionDigits)}%`;
}

export function formatWinRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
