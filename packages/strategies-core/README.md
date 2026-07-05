# @bot/strategies-core

Le cerveau au-dessus de l'exécution : à partir des positions (M7) et du prix
courant (quotes M3), décide _quand_ entrer/sortir et émet des
`buy.requested` / `sell.requested` sur le bus. L'Engine (M7) exécute ; les
stratégies ne signent ni n'envoient rien.

## Le port `Strategy`

`Strategy { type, evaluate(ctx) → StrategyAction[] }` — **pur et
déterministe** : reçoit `{ rule, price, positionAmount, now }`, renvoie des
actions (`emit` une intention, `state` à persister, `status`). Aucun effet de
bord : c'est le `StrategyRunner` qui publie les intentions et persiste l'état.

## Les cinq stratégies

| Type            | Déclenche                                                           |
| --------------- | ------------------------------------------------------------------- |
| `limit`         | Achat/vente quand le prix franchit un seuil (`above`/`below`)       |
| `take-profit`   | Vend une fraction quand prix ≥ entrée × (1 + gainBps)               |
| `stop-loss`     | Vend une fraction quand prix ≤ entrée × (1 − lossBps)               |
| `trailing-stop` | Suit le plus-haut (état persistant), vend au repli de `trailingBps` |
| `dca`           | Achat d'un montant fixe à intervalle, N fois (état = tranches)      |

## Prix

`PriceSource.priceOf(rule)` — prix en base units de quote token par 1e18
unités de token (`PRICE_SCALE`). `QuotePriceSource` le dérive d'une **vraie
quote de vente** (M3) du montant notionnel : c'est le prix _réalisable_ par
l'Engine (slippage inclus), pas un spot théorique. Prix indisponible (pas de
liquidité, quote en échec) ⇒ la règle est simplement sautée ce tick.

## Runner

`StrategyRunner.tick()` (déterministe, testable) évalue les règles actives,
publie les intentions (`source: "strategy"`), persiste l'état et les
transitions de statut. Boucle `start()/stop()`.

**Idempotence** : une règle non-DCA qui émet passe `triggered` et quitte
l'ensemble actif — pas de re-déclenchement. DCA avance son compteur et reste
active jusqu'à la dernière tranche, puis `done`.

## Usage

```ts
import { StrategyRunner, QuotePriceSource, DrizzleStrategyStore } from "@bot/strategies-core";

const { store } = DrizzleStrategyStore.connect(env.DATABASE_URL);
const runner = new StrategyRunner({
  bus,
  store,
  prices: new QuotePriceSource({ adapterFor: (rule) => router.adapterFor(rule.pool) }),
  positions: { amountOf: (chainId, token, sim) => /* depuis le book M7 */ },
});
runner.start();
```

Migration SQL : [`drizzle/0004_strategies.sql`](drizzle/0004_strategies.sql)
(`strategies`, params/state en JSONB avec bigints tagués pour un round-trip
sans perte).

## Hors scope (M8)

App NestJS, UI de création de règles (M13), stratégies composites/OCO,
latence sub-seconde (le tick est de l'ordre de la seconde).

## Tests

- Cinq stratégies testées individuellement (franchissements dans les deux sens,
  TP partiel vs total, trailing qui monte puis retombe, DCA sur N intervalles
  avec horloge mockée).
- Runner : tick → intention publiée, idempotence, état trailing/DCA persistant,
  prix indisponible sauté.
- `QuotePriceSource` (quote réelle → prix scalé).
- Intégration Drizzle/Postgres : round-trip des bigints en JSONB, `listActive`.
