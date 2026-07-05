import type { StrategyStore } from "./ports";
import type { StrategyRule } from "./rules";

/** In-process strategy store for tests and paper trading. */
export class InMemoryStrategyStore implements StrategyStore {
  readonly #rules = new Map<string, StrategyRule>();

  async upsert(rule: StrategyRule): Promise<void> {
    this.#rules.set(rule.id, structuredClone(rule));
  }

  async get(id: string): Promise<StrategyRule | undefined> {
    const rule = this.#rules.get(id);
    return rule === undefined ? undefined : structuredClone(rule);
  }

  async listActive(): Promise<StrategyRule[]> {
    return [...this.#rules.values()]
      .filter((rule) => rule.status === "active")
      .map((rule) => structuredClone(rule));
  }

  async list(): Promise<StrategyRule[]> {
    return [...this.#rules.values()].map((rule) => structuredClone(rule));
  }
}
