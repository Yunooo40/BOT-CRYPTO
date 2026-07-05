import type { ChainReader, DexAdapter } from "@bot/dex-adapters";
import { createDexAdapters } from "@bot/dex-adapters";
import type { Dex, Pool } from "@bot/domain";
import { ValidationError } from "@bot/errors";
import type { Router } from "./ports";

/** Router backed by the M3 adapter registry: pick the adapter by the pool's dex. */
export class AdapterRouter implements Router {
  readonly #adapters: Map<Dex, DexAdapter>;

  constructor(adapters: Map<Dex, DexAdapter>) {
    this.#adapters = adapters;
  }

  /** Build a router directly from a chain client (the RpcPool's in practice). */
  static fromClient(client: ChainReader): AdapterRouter {
    return new AdapterRouter(createDexAdapters(client));
  }

  adapterFor(pool: Pool): DexAdapter {
    const adapter = this.#adapters.get(pool.dex);
    if (adapter === undefined) {
      throw new ValidationError(`No adapter for dex ${pool.dex}`, {
        context: { pool: pool.address },
      });
    }
    return adapter;
  }
}
