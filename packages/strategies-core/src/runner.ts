import { createEvent, type EventBus } from "@bot/events";
import { createLogger, type Logger } from "@bot/logger";
import type { PositionSource, PriceSource, Strategy, StrategyAction, StrategyStore } from "./ports";
import type { StrategyRule } from "./rules";
import { defaultStrategies } from "./strategies";

export interface StrategyRunnerOptions {
  bus: EventBus;
  store: StrategyStore;
  prices: PriceSource;
  positions: PositionSource;
  strategies?: Map<StrategyRule["type"], Strategy>;
  logger?: Logger;
  /** Tick period once started. Default 2 000 ms. */
  intervalMs?: number;
  now?: () => number;
}

/**
 * Evaluates active strategy rules on a tick, applies their actions — publishing
 * `buy.requested` / `sell.requested` intents, persisting state and status
 * transitions. Strategies stay pure; all effects live here.
 *
 * Idempotence: a non-DCA rule that emits transitions to `triggered` and leaves
 * the active set, so it can't re-fire on the next tick. DCA advances its own
 * counter and stays active until the last tranche.
 */
export class StrategyRunner {
  readonly #bus: EventBus;
  readonly #store: StrategyStore;
  readonly #prices: PriceSource;
  readonly #positions: PositionSource;
  readonly #strategies: Map<StrategyRule["type"], Strategy>;
  readonly #logger: Logger;
  readonly #intervalMs: number;
  readonly #now: () => number;

  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: StrategyRunnerOptions) {
    this.#bus = options.bus;
    this.#store = options.store;
    this.#prices = options.prices;
    this.#positions = options.positions;
    this.#strategies = options.strategies ?? defaultStrategies();
    this.#logger = options.logger ?? createLogger({ name: "strategy" });
    this.#intervalMs = options.intervalMs ?? 2_000;
    this.#now = options.now ?? Date.now;
  }

  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => void this.tick(), this.#intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  /** Evaluate every active rule once. Deterministic — the unit tests drive it. */
  async tick(): Promise<void> {
    const rules = await this.#store.listActive();
    for (const rule of rules) {
      await this.#evaluate(rule);
    }
  }

  async #evaluate(rule: StrategyRule): Promise<void> {
    const strategy = this.#strategies.get(rule.type);
    if (strategy === undefined) {
      this.#logger.warn({ rule: rule.id, type: rule.type }, "no strategy for rule type");
      return;
    }
    const price = await this.#prices.priceOf(rule);
    const positionAmount = await this.#positions.amountOf(rule.chainId, rule.token, rule.simulated);
    const actions = strategy.evaluate({ rule, price, positionAmount, now: this.#now() });
    if (actions.length === 0) return;
    await this.#apply(rule, actions);
  }

  async #apply(rule: StrategyRule, actions: StrategyAction[]): Promise<void> {
    let next = rule;
    for (const action of actions) {
      if (action.kind === "emit") {
        const type = action.intent.side === "buy" ? "buy.requested" : "sell.requested";
        await this.#bus.publish(
          createEvent(type, { intent: action.intent }, { source: "strategy" }),
        );
        this.#logger.info(
          { rule: rule.id, type: rule.type, side: action.intent.side },
          "strategy emitted intent",
        );
      } else if (action.kind === "state") {
        next = { ...next, state: action.state };
      } else {
        next = { ...next, status: action.status };
      }
    }
    next = { ...next, updatedAt: this.#now() };
    await this.#store.upsert(next);
  }
}
