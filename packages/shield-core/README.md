# @bot/shield-core

Le cœur du Rugpull Shield : analyse un token/pool et produit un **`RiskScore`
expliqué** (score 0–100, verdict `safe`/`caution`/`danger`, facteurs
détaillés), publié en `risk.assessed`. Deux vitesses, conformément à
l'architecture.

## Deux vitesses

- **`assessQuick`** — le _gate_ rapide pré-trade : uniquement les détecteurs
  bon marché (`fast`), timeout individuel serré (250 ms par défaut), résultat
  mis en cache par token (TTL). Un seul `getCode` + quelques `eth_call`.
- **`assess`** — l'analyse complète asynchrone : les 11 détecteurs.

Chaque détecteur tourne sous un timeout individuel ; une **erreur ou un
timeout** produit un facteur « indéterminé » (score 50, détail explicite),
**jamais un crash ni un faux `safe`**. Le verdict est toujours expliqué :
`RiskScore.factors` conserve le score et le détail de chaque détecteur.

## Les 11 détecteurs

| Détecteur              | Ce qu'il regarde                                                          |
| ---------------------- | ------------------------------------------------------------------------- |
| `liquidity`            | Réserve du token de référence dans le pool, par paliers                   |
| `lp-security`          | Part des LP tokens burn/lock (V2 ; V3 : non évaluable)                    |
| `ownership`            | `owner()`/`getOwner()` — renoncé / EOA / contrat                          |
| `mint`                 | Sélecteurs `mint` dans le bytecode                                        |
| `pause-blacklist`      | Sélecteurs pause / blacklist / freeze                                     |
| `proxy`                | Slot d'implémentation EIP-1967, sinon `delegatecall`                      |
| `limits`               | Sélecteurs max tx / max wallet                                            |
| `taxes`                | Getters de taxe (+ lecture du taux si exposé)                             |
| `honeypot-sell`        | Sanity de la voie de vente (simulation complète = indéterminée sans slot) |
| `supply-concentration` | Part de la supply détenue dans le pool vs ailleurs                        |
| `token-shape`          | Code présent, supply > 0, decimals plausibles                             |

Les heuristiques par sélecteurs sont **faillibles par conception** (un contrat
obfusqué ou proxy peut masquer une fonction) — c'est un score de risque, pas
une garantie, et le détail de chaque facteur le dit.

## Usage

```ts
import { ShieldAnalyzer, attachShield } from "@bot/shield-core";

const analyzer = new ShieldAnalyzer({ client: rpcPool.getClient() });

// À la volée (gate rapide, caché) :
const gate = await analyzer.assessQuick({ token, quoteToken: BASE_WETH, pool });

// Ou branché sur le bus : token.detected → risk.assessed (corrélé).
await attachShield({ bus, analyzer }); // mode "full" par défaut, ou "quick"
```

Le client est un `ShieldClient` (`Pick<PublicClient, "readContract" | "getCode"
| "getStorageAt">`) : n'importe quel `PublicClient` viem convient, dont le
client failover de `@bot/rpc-manager`.

Seuils et poids configurables (`thresholds`, `detectors`). `KNOWN_LOCKERS` est
une constante extensible de lockers LP connus sur Base.

## Tests

- 11 détecteurs testés individuellement (bytecodes fixtures avec/sans
  sélecteurs, lectures mockées, cas limites).
- Agrégation pondérée et verdicts, cache du gate, timeout et erreur →
  facteur indéterminé.
- Pipeline bus de bout en bout (`token.detected` → `risk.assessed` corrélé).
- Opt-in contre Base réel (`BASE_FORK_RPC_URL`) : analyse d'un token établi,
  verdict non-`danger`, 11 facteurs remplis.
