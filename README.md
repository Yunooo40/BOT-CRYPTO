# BOT-CRYPTO

Plateforme de trading de memecoins EVM (chaîne de lancement : **Base**), full
TypeScript, pensée comme un produit professionnel modulaire et maintenable.

> 🚧 En construction, module par module. État actuel : **M0 → M12 livrés**
> (M12 — API Gateway a été avancé hors séquence sur décision explicite, puis
> M4 → M11 livrés dans l'ordre) ; prochaine brique : **M13 — Dashboard**.
> Détail par module : voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Fonctionnalités visées

Sniping rapide · achat/vente manuels · auto-sell · limit orders · take-profit /
stop-loss / trailing stop · DCA · **Rugpull Shield** (honeypot, rug, liquidité,
ownership, mint/freeze, taxes cachées, max wallet/tx, proxy…) · scanner temps réel ·
wallet manager chiffré multi-wallet · copy trading (≤ 50 wallets) · moteur IA
multi-provider · notifications Telegram/Discord/webhook/email · dashboard PnL/ROI.

Feuille de route détaillée et architecture : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Démarrage (développement)

Prérequis : Node ≥ 22, pnpm 9, Docker.

```bash
pnpm install            # dépendances du workspace
cp .env.example .env    # config locale
docker compose up -d    # PostgreSQL + Redis
pnpm check              # typecheck + lint + test + build
```

### API Gateway

```bash
pnpm build                                            # construit dist/
node --env-file=.env apps/api-gateway/dist/migrate.js # applique les migrations
node --env-file=.env apps/api-gateway/dist/main.js    # démarre sur API_PORT (3000)
```

Login : `POST /v1/auth/login` (admin bootstrappé depuis `ADMIN_EMAIL`/`ADMIN_PASSWORD`),
puis JWT ou clé API (`POST /v1/api-keys`) en `Authorization: Bearer …`.
Routes : `/health`, `/v1/status`, `/v1/quotes`, `/v1/api-keys`, WebSocket `/ws`
(flux d'événements du bus par topics).

## Structure

Monorepo pnpm + Turborepo.

| Chemin                  | Rôle                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| `packages/config`       | `@bot/config` — env typé et validé (fail-fast au boot)            |
| `packages/logger`       | `@bot/logger` — logs structurés, secrets redactés                 |
| `packages/errors`       | `@bot/errors` — hiérarchie d'erreurs classifiables                |
| `packages/domain`       | `@bot/domain` — value objects et entités du domaine               |
| `packages/events`       | `@bot/events` — contrat d'événements + bus Redis typé             |
| `packages/rpc-manager`  | `@bot/rpc-manager` — pool RPC : failover, health checks           |
| `packages/dex-adapters` | `@bot/dex-adapters` — Uniswap V2/V3, Aerodrome : quotes, calldata |
| `apps/api-gateway`      | point d'entrée REST + WebSocket : auth, clés API, rate limiting   |
| `docs/`                 | architecture et décisions                                         |

## Licence

Privé, tous droits réservés.
