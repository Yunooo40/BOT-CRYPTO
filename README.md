# BOT-CRYPTO

Plateforme de trading de memecoins EVM (chaîne de lancement : **Base**), full
TypeScript, pensée comme un produit professionnel modulaire et maintenable.

> 🚧 En construction, module par module. État actuel : **M0 — Fondations**.

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

## Structure

Monorepo pnpm + Turborepo.

| Chemin            | Rôle                                                   |
| ----------------- | ------------------------------------------------------ |
| `packages/config` | `@bot/config` — env typé et validé (fail-fast au boot) |
| `packages/logger` | `@bot/logger` — logs structurés, secrets redactés      |
| `packages/errors` | `@bot/errors` — hiérarchie d'erreurs classifiables     |
| `apps/`           | services déployables (à partir de M1)                  |
| `docs/`           | architecture et décisions                              |

## Licence

Privé, tous droits réservés.
