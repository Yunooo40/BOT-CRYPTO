# Architecture — BOT-CRYPTO

> Statut : validé le 2026-07-02. Ce document est la référence ; toute déviation
> doit être discutée et actée ici avant d'être codée.

## Objectif

Plateforme de trading de memecoins EVM, pensée comme un produit professionnel
maintenable sur plusieurs années. Usage personnel d'abord ; l'ouverture en SaaS
reste possible plus tard sans réécriture (le schéma est multi-tenant-ready).

- **Chaîne de lancement :** Base. (Solana envisagée en phase 2 — stack distinct,
  hors périmètre EVM actuel.)
- **Stack :** full TypeScript — NestJS (services), viem (chaîne), Next.js
  (dashboard), PostgreSQL 16 + Drizzle, Redis 7 + BullMQ.

## Principes directeurs

1. **Modularité extrême.** Chaque service est indépendant et déployable seul.
   Aucun import direct d'un service vers un autre : ils communiquent uniquement
   par événements (Redis Streams / pub-sub). Le contrat, ce sont les events.
2. **Sécurité par conception.** Les clés privées ne vivent que dans le Wallet
   Service, chiffrées au repos (AES-256-GCM). Aucun autre service ne voit une clé
   en clair ; la signature est un service, pas une librairie partagée. Les logs
   redactent clés/mnemonics par défaut.
3. **Deux vitesses d'analyse.** Un _gate_ rapide (< 300 ms, cache) décide d'un
   snipe ; le Rugpull Shield complet (11 détecteurs) tourne en asynchrone et peut
   déclencher une sortie a posteriori. On ne bloque jamais le hot path sur une
   analyse lente.
4. **Paper trading natif.** Le mode simulation existe dès le premier jour, au même
   niveau que le mode réel — on teste une stratégie sans risquer un centime.
5. **Hot path isolé derrière un port.** L'exécution (sniper/executor) est cachée
   derrière une interface. Si un jour la latence l'exige, on réimplémente ce
   seul composant en Rust sans toucher au reste.
6. **Qualité non négociable.** SOLID, DRY, KISS, Clean Architecture / DDD,
   Repository Pattern, injection de dépendances, tests unitaires + intégration.

## Vue services

Services déployables, orchestrés dans un monorepo pnpm + Turborepo. Communication
par events uniquement.

```
                         ┌──────────────┐
                         │  Dashboard   │  Next.js
                         └──────┬───────┘
                                │ REST + WebSocket
                         ┌──────┴───────┐
                         │ API Gateway  │  auth JWT / API keys / RBAC / rate limit
                         └──────┬───────┘
                                │ events (Redis)
   ┌───────────┬────────────┬───┴────────┬─────────────┬──────────────┐
   │  Scanner  │   Shield   │   Engine   │ CopyTrading │ Notification │
   │ (nouveaux │ (rugpull / │ (snipe /   │ (suivi de   │ (TG/Discord/ │
   │  tokens,  │  honeypot  │  TP/SL/    │  wallets)   │  webhook/    │
   │  pools)   │  scoring)  │  trailing) │             │  email)      │
   └─────┬─────┴─────┬──────┴─────┬──────┴──────┬──────┴──────────────┘
         │           │            │             │
         └───────────┴─────┬──────┴─────────────┘
                           │
              ┌────────────┴────────────┐
              │  RPC Manager  │  Wallet Service  │  AI Service
              │ (rotation,    │ (clés chiffrées, │ (providers
              │  failover,    │  signature,      │  interchangeables)
              │  load-balance)│  multi-wallet)   │
              └─────────────────────────────────┘
                           │
              PostgreSQL (état)   Redis (events, cache, queues BullMQ)
```

## Découpage en modules

Développement strictement séquentiel, un module à la fois, chacun validé avant le
suivant. Chaque module est autonome.

| #   | Module          | Livre                                                       |
| --- | --------------- | ----------------------------------------------------------- |
| M0  | Fondations      | Monorepo, config, logger, errors, CI, Docker ✅             |
| M1  | Domain & Events | Types du domaine, contrat d'événements, bus Redis typé ✅   |
| M2  | RPC Manager     | Pool de RPC, rotation, health checks, failover ✅           |
| M3  | DEX Adapters    | Abstraction Uniswap V2/V3, Aerodrome — quotes, calldata ✅  |
| M4  | Wallet Service  | Génération/import, chiffrement AES-256-GCM, signature ✅    |
| M5  | Scanner         | Détection temps réel : nouveaux tokens, pools, liquidité ✅ |
| M6  | Rugpull Shield  | 11 détecteurs, score de risque expliqué ✅                  |
| M7  | Trading Engine  | Sniping, achat/vente, auto-sell, retry, paper trading       |
| M8  | Strategies      | Limit, TP, SL, trailing stop, DCA                           |
| M9  | Copy Trading    | Suivi ≤ 50 wallets, copie %, slippage, listes               |
| M10 | AI Service      | Moteur multi-provider (OpenAI/Gemini/Claude/Grok)           |
| M11 | Notifications   | Telegram, Discord, webhook, email                           |
| M12 | API Gateway     | REST + WebSocket, JWT, API keys, permissions, rate limiting |
| M13 | Dashboard       | Next.js — PnL, ROI, positions, historique, analytics        |
| M14 | Observabilité   | Métriques, traces, audit trail, alerting                    |

## État actuel

**M0 — Fondations ✅**, **M1 — Domain & Events ✅**, **M2 — RPC Manager ✅**,
**M3 — DEX Adapters ✅**, **M4 — Wallet Service (cœur) ✅**,
**M5 — Scanner (cœur) ✅** et **M6 — Rugpull Shield (cœur) ✅** sont livrés.

- **M0** : monorepo pnpm + Turborepo, TypeScript strict, packages socles
  (`@bot/config`, `@bot/logger`, `@bot/errors`), CI GitHub Actions, stack de dev
  Docker (PostgreSQL + Redis).
- **M1** : `@bot/domain` (value objects & entités purs — `Address`, `TokenAmount`
  en bigint, `Token`, `Pool`, `RiskScore`, `Trade`, `Position`) et `@bot/events`
  (contrat d'événements Zod + bus `EventBus` avec `InMemoryEventBus` pour les
  tests/paper trading et `RedisEventBus` sur Redis Streams, livraison at-least-once).
- **M2** : `@bot/rpc-manager` — pool d'endpoints RPC derrière un `PublicClient`
  viem virtuel : load-balance pondéré (smooth weighted round-robin), failover
  transparent sur erreur d'infrastructure, circuit breaker par endpoint avec
  cool-down exponentiel, health checks périodiques, `RpcInfraError` retryable
  quand tout est down. Config `BASE_RPC_URLS` (`url[|poids][|wsUrl]`, séparés
  par des virgules) validée par `@bot/config`. Les erreurs applicatives
  JSON-RPC (revert…) remontent telles quelles, sans failover.
- **M3** : `@bot/dex-adapters` — port `DexAdapter` (résolution de pool, état,
  `quoteExactIn`, `buildSwapCalldata` pur) et trois adapters : Uniswap V2 (math
  x·y=k locale + impact prix), Uniswap V3 (QuoterV2, deadline via `multicall`
  du SwapRouter02), Aerodrome (routes stable/volatile via le router, fees
  par pool). Adresses canoniques Base surchargeables, `createDexAdapters()`
  pour itérer sur les venues, `PoolNotFoundError` (DomainError). Single-hop,
  lecture seule — la signature/envoi arrive en M4/M7 ; les taxes de tokens
  fee-on-transfer ne sont pas modélisées dans la quote (Shield, M6).
  Tests d'intégration opt-in contre un fork anvil ou RPC Base live
  (`BASE_FORK_RPC_URL`), skippés sinon.
- **M4** : `@bot/wallet-core` — génération/import de wallets, clés privées
  chiffrées AES-256-GCM (scrypt N=2¹⁵ + salt par enveloppe, AAD = adresse,
  format versionné `v1:`), signature tx/message/typed-data avec clé claire
  limitée à la durée de l'appel (buffer zeroizé). `WalletRepository` en
  in-memory (tests/paper) et Drizzle/PostgreSQL (table `wallets`,
  multi-tenant-ready). `WALLET_MASTER_KEY` ajoutée au contrat d'env. L'app
  NestJS wallet-service (port réseau de signature) arrivera avec M7.

- **M5** : `@bot/scanner-core` — un watcher par venue (polling `eth_getLogs`
  des factories par plages bornées, via le client failover de M2), curseur de
  blocs persistant par venue (reprise sans trou), déduplication des pools,
  enrichissement défensif des métadonnées token (repli bytes32/valeurs par
  défaut), filtre token de référence (WETH) + liquidité minimale optionnelle,
  backoff sur erreur RPC. Publie `pool.created` + `token.detected` corrélés
  (catalogue M1). État en in-memory ou Drizzle/PostgreSQL (`scan_cursors`,
  `seen_pools`).

- **M6** : `@bot/shield-core` — port `Detector` (isolé, sous timeout, échec →
  facteur « indéterminé », jamais de faux `safe`) et 11 détecteurs (liquidité,
  sécurité LP, ownership, mint, pause/blacklist, proxy EIP-1967, limites,
  taxes, honeypot-sell, concentration de supply, forme du token). `ShieldAnalyzer`
  à deux vitesses : `assessQuick` (détecteurs `fast`, timeout serré, caché par
  token) et `assess` (les 11). Agrégation pondérée → `RiskScore` expliqué
  (score/verdict/facteurs, M1), seuils configurables. `attachShield` branche
  `token.detected` → `risk.assessed` (corrélé). Heuristiques par sélecteurs
  assumées faillibles — score de risque, pas garantie.

Prochaine étape : **M7 — Trading Engine**. Les `apps/` (services) arrivent quand
un service concret consomme ces briques.
