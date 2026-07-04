# @bot/scanner-core

Le cœur du Scanner : détection temps réel des nouveaux pools (et donc des
nouveaux tokens) sur Base — la source amont de tout le pipeline
(`pool.created` / `token.detected` → Shield → Engine). L'app NestJS
`apps/scanner` l'assemblera quand le pipeline aura un consommateur
bout-en-bout.

## Fonctionnement

- **Un watcher par venue** (Uniswap V2, Uniswap V3, Aerodrome) : polling
  `eth_getLogs` des événements `PairCreated`/`PoolCreated` des factories, par
  plages de blocs bornées (`maxBlockRange`), via n'importe quel `PublicClient`
  viem — celui du `RpcPool` (M2) en pratique, donc failover inclus.
- **Curseur persistant par venue** (`ScanCursorStore`) : un redémarrage reprend
  exactement où il s'était arrêté — pas de trou, pas de re-scan. Premier
  démarrage : on part de la tête (l'historique n'est pas le travail du
  scanner).
- **Déduplication** (`SeenPoolStore`) : reprises et chevauchements de plages ne
  publient jamais deux fois. La publication est at-least-once (les
  consommateurs du bus sont idempotents par contrat M1).
- **Enrichissement défensif** : `symbol`/`name`/`decimals` du token lancé, avec
  repli bytes32 et valeurs par défaut — un memecoin aux métadonnées cassées ne
  fait pas tomber le pipeline.
- **Filtres** : par défaut, seuls les pools appariés à un token de référence
  (WETH) sont publiés (`quoteTokens: []` pour tout publier) ;
  `minQuoteLiquidity` optionnel, évalué au moment de la détection (off par
  défaut — beaucoup de lancements ajoutent la liquidité après la création).
- **Résilience** : backoff exponentiel (plafonné 30 s) sur erreur RPC, reprise
  immédiate quand on est en retard sur la tête, compteurs `stats()`.

## Usage

```ts
import { Scanner, DrizzleScanState } from "@bot/scanner-core";

const { state, close } = DrizzleScanState.connect(env.DATABASE_URL);
const scanner = new Scanner({
  client: rpcPool.getClient(),
  bus, // EventBus (M1) — RedisEventBus en réel, InMemoryEventBus en paper/tests
  cursors: state,
  seen: state,
});
scanner.start(); // …
scanner.stop();
```

Événements publiés (catalogue M1, `source: "scanner"`) : un `pool.created`
puis un `token.detected` corrélé par pool découvert.

Migration SQL : [`drizzle/0002_scanner.sql`](drizzle/0002_scanner.sql)
(`scan_cursors`, `seen_pools`).

## Tests

- Unitaires (client mocké) : décodage des trois événements factory encodés
  avec viem, pagination, reprise depuis curseur, déduplication, filtres,
  métadonnées cassées, start/stop, backoff.
- Intégration Drizzle/Postgres : skippée si la DB est injoignable, exigée en
  CI (`DATABASE_URL`).
- Opt-in contre Base réel : `BASE_FORK_RPC_URL=… pnpm --filter
@bot/scanner-core test` — décode de vrais logs récents des trois factories.
