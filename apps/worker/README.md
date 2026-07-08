# @bot/worker

The trading loop as a deployable process: it scans Base for new pools, arms a
one-shot **snipe** per detected token, executes the resulting buys through the
engine, and — after each fill — arms a **take-profit + stop-loss** to manage the
position. Paper by default; live only behind explicit gates.

## Flow

```
Scanner ──token.detected──▶ Sniper ──upsert snipe rule──▶ StrategyRunner
                                                              │ buy.requested
                                                              ▼
                                                           Engine ──trade.executed──▶ Exit armer
                                                              ▲                          │ upsert tp:/sl:
                                                              └────── sell.requested ────┘  (StrategyRunner)
```

- **Sniper** (`sniper.ts`) — one buy per token, never rebuys. Shield gates it.
- **Engine** — paper or live executor; a `danger` Shield verdict rejects a buy.
- **Exit armer** (`exits.ts`) — on every executed **buy**, arm a take-profit and
  a stop-loss keyed off the fill's entry price, against the same book/wallet.
  The runner evaluates them each tick and fires the exit sell when a level is
  crossed. Entry price is buy-side (what was paid), so an immediate sell quote
  sits a round-trip spread below it — keep `EXIT_SL_LOSS_BPS` generous.

## Modes

`WORKER_MODE` selects the execution path (default `paper`):

- **`paper`** — real on-chain quotes, no transactions, in-memory books. No key.
- **`live`** — real signatures via the Wallet Service (M4), Postgres-backed
  position/strategy books (a restart never drops an open position or its stop),
  behind a hard per-trade notional cap.

Live refuses to start unless **all** of these are set:

| Var                                | Meaning                                                 |
| ---------------------------------- | ------------------------------------------------------- |
| `WORKER_MODE=live`                 | Select live execution.                                  |
| `WORKER_LIVE_CONFIRM=I_UNDERSTAND` | Explicit confirmation — a stray env var can't go live.  |
| `WORKER_WALLET_ID=<uuid>`          | Wallet Service id whose key signs (must already exist). |
| `WORKER_MAX_NOTIONAL_WEI=<n>`      | Max quote base units a single buy may spend.            |
| `WALLET_MASTER_KEY=<16+ chars>`    | Master key the keystore decrypts with.                  |

A buy over the cap fails as a terminal error (no retry) and never executes.

## Config

| Var                       | Default                     | Meaning                                                  |
| ------------------------- | --------------------------- | -------------------------------------------------------- |
| `WORKER_SNIPE_QUOTE_WEI`  | `1e15` (0.001 WETH)         | Quote spent per snipe buy.                               |
| `WORKER_MAX_SLIPPAGE_BPS` | `500`                       | Slippage tolerated on snipe buys.                        |
| `WORKER_TICK_MS`          | `2000`                      | Strategy runner tick period.                             |
| `WORKER_SCAN_POLL_MS`     | `1500`                      | Scanner poll interval.                                   |
| `EXIT_TP_GAIN_BPS`        | `5000`                      | Take-profit trigger (+50%).                              |
| `EXIT_SL_LOSS_BPS`        | `3000`                      | Stop-loss trigger (−30%).                                |
| `EXIT_SELL_FRACTION_BPS`  | `10000`                     | Fraction each exit sells (all).                          |
| `EXIT_MAX_SLIPPAGE_BPS`   | = `WORKER_MAX_SLIPPAGE_BPS` | Slippage on exit sells.                                  |
| `WORKER_SEED`             | `false`                     | Demo only: arm a WETH/USDC snipe at boot. Never in prod. |

## Out of scope (this pass)

- **DCA** as a configured accumulation campaign (deferred — separate pass).
- Averaging an entry across multiple buys before re-arming exits (the snipe flow
  is one buy per token; re-arming overwrites with the latest fill's price).
- Concurrent-nonce management: one in-flight tx at a time per wallet.
