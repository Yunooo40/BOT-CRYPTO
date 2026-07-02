# CLAUDE.md — BOT-CRYPTO

Contexte et conventions pour les sessions de travail sur ce dépôt.

## Ce qu'est le projet

Plateforme de trading de memecoins EVM (chaîne de lancement : **Base**), full
TypeScript, pensée comme un produit pro maintenable des années. Usage personnel
d'abord, multi-tenant-ready pour une éventuelle ouverture SaaS. Voir
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — c'est la référence.

## Protocole de développement (IMPÉRATIF)

On avance **un module à la fois**, dans l'ordre M0 → M14. Pour chaque module :

1. **Spec** détaillée (objectif, livrables, critères de fin) présentée d'abord.
2. **Validation explicite** de l'utilisateur avant d'écrire du code.
3. **Implémentation** du seul module validé + tests.
4. **Revue** : les critères de fin sont vérifiés et montrés.

Ne jamais coder plusieurs modules d'un coup. Ne jamais anticiper un module suivant.

## Stack

- Monorepo **pnpm** (workspaces) + **Turborepo**.
- **TypeScript** strict (voir `tsconfig.base.json`), ESM, `verbatimModuleSyntax`.
- Services : **NestJS**. Chaîne : **viem**. Dashboard : **Next.js**.
- **PostgreSQL 16** + **Drizzle**. **Redis 7** + **BullMQ**.
- Tests : **Vitest** (+ anvil/Foundry pour les fork-tests on-chain à partir de M3).
- Lint **ESLint** (flat config), format **Prettier**.

## Commandes

```bash
pnpm install            # installer tout le workspace
pnpm build              # build de tous les packages (Turborepo)
pnpm test               # tests unitaires
pnpm lint               # ESLint
pnpm typecheck          # tsc --noEmit partout
pnpm check              # typecheck + lint + test + build (le tout)
pnpm format             # Prettier --write
docker compose up -d    # PostgreSQL + Redis en local
```

## Structure

```
packages/   # librairies partagées, sans effet de bord réseau
  config/   # @bot/config  — env typé + validé (Zod), fail-fast
  logger/   # @bot/logger  — pino structuré, redaction des secrets
  errors/   # @bot/errors  — hiérarchie d'erreurs (Domain/Infra/Validation)
apps/        # services déployables (arrivent à partir de M1)
docs/        # ARCHITECTURE.md et décisions
```

## Règles de code

- **Aucun import direct entre services** : ils communiquent par événements (Redis).
  Les `packages/` sont partageables ; les `apps/` ne s'importent jamais entre eux.
- **Clés privées** : uniquement dans le Wallet Service, chiffrées (AES-256-GCM).
  Aucune clé en clair ailleurs. Ne jamais logger de clé/mnemonic (le logger les
  redacte, mais ne comptez pas dessus — n'en passez pas).
- **Erreurs** : lever une sous-classe de `BaseError` (`@bot/errors`), jamais un
  `throw "string"`. `InfraError` = retryable, `DomainError`/`ValidationError` = non.
- **Config** : tout accès à `process.env` passe par `@bot/config` (validé au boot).
- **Imports de types** : `import type { ... }` (imposé par `verbatimModuleSyntax`).
- Chaque package expose une API claire via `src/index.ts` et a de vrais tests.

## Scope des sessions subagent

Le protocole « un module à la fois avec validation » s'applique aux sessions
principales. Un subagent dépêché pour une tâche précise l'exécute directement.
