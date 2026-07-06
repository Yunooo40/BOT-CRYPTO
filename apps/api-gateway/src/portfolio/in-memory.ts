import {
  decodeCursor,
  encodeCursor,
  type TradeHistoryPage,
  type TradeHistoryQuery,
  type TradeHistoryRecord,
  type TradeHistoryRepository,
} from "./trade-history";

/** For tests and paper setups — mirrors `DrizzleTradeHistoryRepository`'s ordering. */
export class InMemoryTradeHistoryRepository implements TradeHistoryRepository {
  readonly #byId = new Map<string, TradeHistoryRecord>();

  async append(record: TradeHistoryRecord): Promise<void> {
    if (this.#byId.has(record.id)) {
      return;
    }
    this.#byId.set(record.id, record);
  }

  async list(query: TradeHistoryQuery): Promise<TradeHistoryPage> {
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const sorted = [...this.#byId.values()].sort(
      (a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id),
    );
    const start =
      cursor === undefined
        ? 0
        : sorted.findIndex(
            (record) =>
              record.occurredAt < cursor.occurredAt ||
              (record.occurredAt === cursor.occurredAt && record.id < cursor.id),
          );
    const from = start === -1 ? sorted.length : start;
    const page = sorted.slice(from, from + query.limit);
    const last = page[page.length - 1];
    const hasMore = from + query.limit < sorted.length;
    return {
      items: page,
      ...(hasMore && last !== undefined
        ? { nextCursor: encodeCursor({ occurredAt: last.occurredAt, id: last.id }) }
        : {}),
    };
  }

  async listAll(): Promise<TradeHistoryRecord[]> {
    return [...this.#byId.values()].sort((a, b) => a.occurredAt - b.occurredAt);
  }
}
