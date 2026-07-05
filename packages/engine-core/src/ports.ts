import type { Address, ChainId, Pool, Trade, TradeIntent } from "@bot/domain";
import type { DexAdapter } from "@bot/dex-adapters";

/**
 * Signs and broadcasts transactions. Implemented in production by the Wallet
 * Service (M4) wrapping a viem `WalletClient`; the engine never sees a key.
 */
export interface Signer {
  readonly address: Address;
  /** Sign + send a raw transaction, returning its hash. */
  sendTransaction(tx: { to: Address; data: `0x${string}`; value: bigint }): Promise<`0x${string}`>;
  /** Wait until the transaction is mined; resolves to success/failure. */
  waitForSuccess(hash: `0x${string}`): Promise<boolean>;
}

/**
 * Resolves which pool/adapter to trade a token through. The engine stays out of
 * routing decisions — the Scanner/caller supplies the pool, this maps it to its
 * adapter.
 */
export interface Router {
  adapterFor(pool: Pool): DexAdapter;
}

/**
 * The hot path behind an interface (architecture principle #5). Two
 * implementations — paper and live — are fully interchangeable; a strategy or
 * the bus never knows which one it drives.
 */
export interface Executor {
  readonly mode: "paper" | "live";
  execute(request: ExecuteRequest): Promise<Trade>;
}

/** A trade intent resolved against a concrete pool, ready to execute. */
export interface ExecuteRequest {
  intent: TradeIntent;
  pool: Pool;
  /** Idempotency key — the same key must never execute twice. */
  intentId: string;
}

export interface PositionStore {
  get(chainId: ChainId, token: Address, simulated: boolean): Promise<PositionRecord | undefined>;
  upsert(record: PositionRecord): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<PositionRecord[]>;
}

/** Persisted position with realized PnL, in quote-asset base units. */
export interface PositionRecord {
  id: string;
  chainId: ChainId;
  token: Address;
  simulated: boolean;
  /** Token base units currently held. */
  amount: bigint;
  /** Total quote spent acquiring the current `amount` (cost basis). */
  costBasis: bigint;
  /** Realized PnL in quote base units, accumulated over closed portions. */
  realizedPnl: bigint;
  openedAt: number;
  updatedAt: number;
}
