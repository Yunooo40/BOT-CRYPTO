# @bot/engine-core

Le cœur du Trading Engine : exécute les intentions de trade (quote via M3,
signature via M4), avec **paper trading natif** au même niveau que le réel.
C'est le _hot path derrière un port_ de l'architecture (principe #5).

## Le port `Executor`

`Executor { execute(request) → Trade }` — deux implémentations
interchangeables ; ni une stratégie ni le bus ne savent laquelle tourne :

- **`PaperExecutor`** : quote réelle on-chain (M3) mais **aucune transaction**.
  Règle contre la quote, `simulated: true`, hash déterministe `0xpaper…`.
  Zéro risque, même chemin que le live (quote + garde de slippage).
- **`LiveExecutor`** : quote → `buildSwapCalldata` (M3) → **approve ERC-20 si
  l'allowance est insuffisante** → signature/envoi via le port `Signer`
  (implémenté par le Wallet Service M4) → attente du reçu → `Trade` réel.
  L'`amountOutMin` du calldata fait respecter le slippage on-chain.

Si un jour la latence l'exige, on réécrit ce seul port en Rust — le reste ne
bouge pas.

## `TradingEngine`

Orchestre un trade : gate pré-trade optionnel → exécution → mise à jour de la
position.

- **Retry** : les `InfraError` (dont `RpcInfraError` de M2) sont réessayées
  avec backoff borné ; les `DomainError` (slippage, revert, honeypot) sont
  terminales → `trade.failed { retryable: false }`.
- **Idempotence** : une intention n'est exécutée qu'une fois (clé = `intentId`,
  l'id d'événement sur le bus) — une redélivrance at-least-once ne double-trade
  jamais.
- **Gate Shield** : `preTradeCheck` optionnel, non branché par défaut (le cœur
  ne se couple pas en dur au Shield ; l'app câble `assessQuick` de M6). Un
  verdict `danger` sur un buy annule le trade.
- **Positions & PnL** : `applyTrade` ouvre/moyenne à l'achat, réduit/clôture à
  la vente, réalise le PnL au prorata de la base de coût. Paper et live sont
  des books séparés.

## Usage

```ts
import { TradingEngine, PaperExecutor, AdapterRouter, InMemoryPositionStore, attachEngine } from "@bot/engine-core";

const router = AdapterRouter.fromClient(rpcPool.getClient());
const engine = new TradingEngine({
  executor: new PaperExecutor({ router }), // ou LiveExecutor({ router, signer, client })
  positions: new InMemoryPositionStore(), // ou DrizzlePositionStore
});

// Direct :
const result = await engine.trade(intent, pool, intentId);

// Ou branché sur le bus : buy/sell.requested → trade.executed / trade.failed.
await attachEngine({ bus, engine, resolvePool: async (intent) => /* … */ });
```

Migration SQL : [`drizzle/0003_positions.sql`](drizzle/0003_positions.sql)
(`positions`, avec PnL réalisé, séparation paper/live).

## Hors scope (M7)

- App NestJS engine (arrive avec le premier déploiement).
- TP / SL / trailing / DCA → **M8 (Strategies)**, qui consommera les positions.
- Gestion fine du nonce multi-tx concurrentes : une intention à la fois par
  wallet en M7.

## Tests

- Paper bout-en-bout (quote mockée → Trade simulé, position, PnL).
- Live par mocks : approve conditionnel, swap, reçu → Trade ; revert → erreur
  non-retryable.
- Classification retry (infra rejoué avec backoff, domain terminal),
  idempotence, gate pré-trade, agrégation de position.
- Pipeline bus `buy.requested → trade.executed` corrélé.
- Intégration Drizzle/Postgres (skippée sans DB, exigée en CI).
- Fork-test opt-in (`BASE_FORK_RPC_URL`) : paper-trade d'une vraie quote.
