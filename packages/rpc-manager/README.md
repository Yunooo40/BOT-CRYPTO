# @bot/rpc-manager

Pool de endpoints RPC derrière un unique `PublicClient` viem. Tous les services
on-chain (Scanner, Shield, Engine, Wallet…) passent par lui : aucun service ne
parle à un RPC en dur.

## Ce qu'il fait

- **Load-balance** : smooth weighted round-robin entre les endpoints sains — un
  endpoint de poids 2 reçoit exactement deux fois plus de trafic.
- **Failover transparent** : une erreur d'infrastructure (réseau, timeout, HTTP,
  nœud en faute) fait réessayer la requête sur le endpoint sain suivant, jusqu'à
  `maxAttemptsPerRequest` endpoints distincts.
- **Circuit breaker par endpoint** : après `failureThreshold` échecs consécutifs,
  le endpoint sort de la rotation le temps d'un cool-down exponentiel
  (`cooldownMs` → `maxCooldownMs`), puis est re-testé (half-open).
- **Health checks** : `start()` lance une sonde périodique (`eth_blockNumber`,
  latence mesurée) qui fait revenir les nœuds morts sans attendre le cool-down.
- **Erreurs classifiées** : les erreurs applicatives JSON-RPC (revert, invalid
  params…) remontent telles quelles — le nœud a répondu, réessayer ailleurs
  donnerait la même chose. Seules les erreurs d'infrastructure déclenchent le
  failover ; si tout est down, `RpcInfraError` (sous-classe d'`InfraError`,
  donc retryable).

## Usage

```ts
import { loadEnv } from "@bot/config";
import { RpcPool, rpcEndpointsFromEnv } from "@bot/rpc-manager";

const env = loadEnv();
const pool = new RpcPool({ endpoints: rpcEndpointsFromEnv(env) });
pool.start(); // health checks périodiques (optionnel mais recommandé)

const client = pool.getClient(); // PublicClient viem, failover intégré
const block = await client.getBlockNumber();

pool.health(); // état de chaque endpoint (status, échecs, latence)
pool.stop();
```

Construire un pool ne touche jamais le réseau ; seuls les appels du client et
les health checks après `start()` le font.

## Config

`BASE_RPC_URLS` (validée par `@bot/config`) : entrées séparées par des virgules,
chacune au format `url[|poids][|wsUrl]` :

```
BASE_RPC_URLS=https://mainnet.base.org,https://node.example|3|wss://node.example
```

Le `wsUrl` est stocké pour les subscriptions à venir (Scanner, M5) — inutilisé
en M2. `parseRpcEndpoints` rejette toute entrée invalide avec le détail de
chaque problème.

## Sémantique d'erreur, en deux niveaux

- `pool.request({ method, params })` — JSON-RPC brut : rejette directement avec
  `RpcInfraError` quand tous les endpoints sont indisponibles.
- `pool.getClient()` — client viem typé : viem enveloppe les erreurs non-viem
  (`UnknownRpcError`), la `RpcInfraError` reste accessible sur la chaîne des
  `cause`. Les erreurs applicatives (revert…) restent des erreurs viem
  normales.
