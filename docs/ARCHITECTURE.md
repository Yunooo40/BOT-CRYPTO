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

| #   | Module          | Livre                                                          |
| --- | --------------- | -------------------------------------------------------------- |
| M0  | Fondations      | Monorepo, config, logger, errors, CI, Docker ✅                |
| M1  | Domain & Events | Types du domaine, contrat d'événements, bus Redis typé ✅      |
| M2  | RPC Manager     | Pool de RPC, rotation, health checks, failover ✅              |
| M3  | DEX Adapters    | Abstraction Uniswap V2/V3, Aerodrome — quotes, calldata ✅     |
| M4  | Wallet Service  | Génération/import, chiffrement AES-256-GCM, signature ✅        |
| M5  | Scanner         | Détection temps réel : nouveaux tokens, pools, liquidité ✅     |
| M6  | Rugpull Shield  | 11 détecteurs, score de risque expliqué ✅                      |
| M7  | Trading Engine  | Sniping, achat/vente, auto-sell, retry, paper trading ✅        |
| M8  | Strategies      | Limit, TP, SL, trailing stop, DCA ✅                            |
| M9  | Copy Trading    | Suivi ≤ 50 wallets, copie %, slippage, listes ✅               |
| M10 | AI Service      | Moteur multi-provider (OpenAI/Gemini/Claude/Grok) ✅            |
| M11 | Notifications   | Telegram, Discord, webhook, email ✅                            |
| M12 | API Gateway     | REST + WebSocket, JWT, API keys, permissions, rate limiting ✅ |
| M13 | Dashboard       | Next.js — PnL, ROI, positions, historique, analytics           |
| M14 | Observabilité   | Métriques, traces, audit trail, alerting                       |

## État actuel

**M0 → M12 sont livrés** : **M0 — Fondations ✅**, **M1 — Domain & Events ✅**,
**M2 — RPC Manager ✅**, **M3 — DEX Adapters ✅**, **M4 — Wallet Service ✅**,
**M5 — Scanner ✅**, **M6 — Rugpull Shield ✅**, **M7 — Trading Engine ✅**,
**M8 — Strategies ✅**, **M9 — Copy Trading ✅**, **M10 — AI Service ✅**,
**M11 — Notifications ✅** et **M12 — API Gateway ✅**.

> **Déviation de séquence actée (2026-07-05)** : M12 a été avancé avant M4-M11
> sur décision explicite, pour poser tôt le socle HTTP/auth et le pattern
> NestJS des services. La séquence M4 → M11 a ensuite été livrée dans l'ordre ;
> les routes de ces modules se brancheront sur la gateway au fil de leur
> exposition HTTP/WebSocket.

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
- **M12** : `apps/api-gateway` — première application NestJS du monorepo, point
  d'entrée REST + WebSocket unique. Auth à deux modes : sessions **JWT** HS256
  (login email/mot de passe, hash **scrypt**, admin bootstrappé depuis l'env)
  et **clés API** `bk_…` stockées hashées SHA-256, avec scopes
  `read`/`trade`/`admin` imposés par guard global (fail-closed). Rate limiting
  fenêtre glissante sur Redis (buckets par identité + bucket login par IP,
  `429` + `Retry-After`). Persistance **Drizzle/PostgreSQL** (tables `users`,
  `api_keys` possédées par la gateway, migrations drizzle-kit) derrière des
  repositories (impl. in-memory pour tests/paper). WebSocket `/ws` : flux des
  événements du bus par topics avec contrôle de scope, heartbeat, éviction des
  consommateurs lents (groupe de consommateurs Redis unique par instance pour
  obtenir un broadcast). Routes sur l'existant : `/health`, `/v1/status`
  (probes RPC/Postgres/Redis), `/v1/quotes` (meilleure quote cross-venues M3
  sur le pool M2). Mapping d'erreurs unique : `ValidationError`→400,
  `PoolNotFound`→404, `DomainError`→422, `InfraError`→503 (en remontant la
  chaîne des `cause` — viem enrobe les erreurs du pool), jamais de stack ni de
  secret en réponse. E2E supertest + ws sur fakes in-memory ; intégration
  Postgres/Redis opt-in (exigée en CI, services dédiés).
- **M4** : `@bot/wallet-core` — génération/import de wallets, chiffrement des
  clés privées en AES-256-GCM, signature de transactions. Aucune clé en clair
  hors de ce module.
- **M5** : `@bot/scanner-core` — détection temps réel des nouveaux tokens,
  pools et évolutions de liquidité.
- **M6** : `@bot/shield-core` — Rugpull Shield : 11 détecteurs de risque et
  score expliqué.
- **M7** : `@bot/engine-core` — Trading Engine : sniping, achat/vente,
  auto-sell, retry, paper trading.
- **M8** : `@bot/strategies-core` — stratégies : limit, take-profit, stop-loss,
  trailing stop, DCA.
- **M9** : `@bot/copy-core` — Copy Trading : suivi de wallets (≤ 50), copie en
  pourcentage, gestion du slippage et des listes.
- **M10** : `@bot/ai-core` — moteur IA multi-provider (OpenAI/Gemini/Claude/Grok).
- **M11** : `@bot/notify-core` — notifications Telegram, Discord, webhook, email.

Prochaine étape : **M13 — Dashboard** (Next.js — PnL, ROI, positions, historique,
analytics), puis **M14 — Observabilité**.
