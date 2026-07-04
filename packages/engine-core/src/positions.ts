import type { Address, ChainId, Trade } from "@bot/domain";
import type { PositionRecord, PositionStore } from "./ports";

/** In-process position book for tests and paper trading. */
export class InMemoryPositionStore implements PositionStore {
  readonly #byKey = new Map<string, PositionRecord>();

  #key(chainId: ChainId, token: Address, simulated: boolean): string {
    return `${chainId}:${token}:${simulated ? "sim" : "live"}`;
  }

  async get(
    chainId: ChainId,
    token: Address,
    simulated: boolean,
  ): Promise<PositionRecord | undefined> {
    const record = this.#byKey.get(this.#key(chainId, token, simulated));
    return record === undefined ? undefined : { ...record };
  }

  async upsert(record: PositionRecord): Promise<void> {
    this.#byKey.set(this.#key(record.chainId, record.token, record.simulated), { ...record });
  }

  async remove(id: string): Promise<void> {
    for (const [key, record] of this.#byKey) {
      if (record.id === id) {
        this.#byKey.delete(key);
        return;
      }
    }
  }

  async list(): Promise<PositionRecord[]> {
    return [...this.#byKey.values()].map((record) => ({ ...record }));
  }
}

/**
 * Fold a settled trade into the position book.
 *
 * - **buy**: add tokens, add the quote spent (`amountIn`) to the cost basis.
 * - **sell**: reduce tokens; realize PnL on the sold fraction as
 *   `proceeds − (costBasis × soldFraction)`; drop the position when fully sold.
 *
 * Quote amounts are the intent's `amountIn` (buy) and the trade's `amountOut`
 * (sell) — both in the quote asset's base units.
 */
export async function applyTrade(
  store: PositionStore,
  trade: Trade,
  now: () => number,
): Promise<PositionRecord | undefined> {
  const existing = await store.get(trade.chainId, trade.token, trade.simulated);

  if (trade.side === "buy") {
    const record: PositionRecord = existing ?? {
      id: `${trade.chainId}:${trade.token}:${trade.simulated ? "sim" : "live"}`,
      chainId: trade.chainId,
      token: trade.token,
      simulated: trade.simulated,
      amount: 0n,
      costBasis: 0n,
      realizedPnl: 0n,
      openedAt: now(),
      updatedAt: now(),
    };
    record.amount += trade.amountOut.raw;
    record.costBasis += trade.amountIn.raw;
    record.updatedAt = now();
    await store.upsert(record);
    return record;
  }

  // sell
  if (existing === undefined || existing.amount === 0n) {
    // Selling something we don't track (external transfer, manual): record the
    // proceeds as pure realized PnL rather than inventing a negative basis.
    return existing;
  }
  const sold = trade.amountIn.raw <= existing.amount ? trade.amountIn.raw : existing.amount;
  const basisSold = (existing.costBasis * sold) / existing.amount;
  const proceeds = trade.amountOut.raw;
  existing.realizedPnl += proceeds - basisSold;
  existing.amount -= sold;
  existing.costBasis -= basisSold;
  existing.updatedAt = now();
  if (existing.amount === 0n) {
    await store.remove(existing.id);
    return { ...existing };
  }
  await store.upsert(existing);
  return existing;
}
