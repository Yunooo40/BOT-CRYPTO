# @bot/dex-adapters

Abstraction unique au-dessus des DEX de Base — **Uniswap V2**, **Uniswap V3**,
**Aerodrome** — pour résoudre des pools, produire des quotes et construire le
calldata de swap prêt à signer. Lecture seule : aucune signature, aucun envoi
(Wallet Service M4, Engine M7).

## Le port `DexAdapter`

```ts
interface DexAdapter {
  readonly dex: Dex; // "uniswap-v2" | "uniswap-v3" | "aerodrome"
  getPool(query): Promise<Pool | undefined>; // undefined si le pool n'existe pas
  getPoolState(pool): Promise<PoolState>; // réserves (v2) ou liquidity/sqrtPrice (v3)
  quoteExactIn(params): Promise<Quote>; // amountOut pour un amountIn exact
  buildSwapCalldata(params): SwapCall; // { to, data, value } — pur, aucun I/O
}
```

Tous les montants sont des `bigint` en base units — les decimals appartiennent
à la couche Token. `requirePool(adapter, query)` lève `PoolNotFoundError`
(`DomainError`, non-retryable) quand le pool doit exister.

## Usage

```ts
import { createDexAdapters, requirePool, BASE_WETH } from "@bot/dex-adapters";

const adapters = createDexAdapters(pool.getClient()); // client du RpcPool (M2)
const v3 = adapters.get("uniswap-v3")!;

const wethMeme = await requirePool(v3, { tokenA: BASE_WETH, tokenB: meme, feeTier: 3000 });
const quote = await v3.quoteExactIn({ pool: wethMeme, tokenIn: BASE_WETH, amountIn: 10n ** 17n });
const call = v3.buildSwapCalldata({
  pool: wethMeme,
  tokenIn: BASE_WETH,
  amountIn: quote.amountIn,
  expectedAmountOut: quote.amountOut,
  slippageBps: 200, // amountOutMin = quote − 2 %
  recipient: wallet,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
});
// call = { to: router, data: 0x…, value: 0n } — à signer/envoyer en M4/M7
```

Le client requis est un `ChainReader` (`Pick<PublicClient, "readContract">`) :
n'importe quel `PublicClient` viem convient, dont le client virtuel de
`@bot/rpc-manager`, sans dépendance entre les deux packages.

## Spécificités par venue

- **Uniswap V2** — quote locale depuis les réserves (x·y=k, fee 0,3 %), avec
  `priceImpactBps` (fee incluse). Swap : `swapExactTokensForTokens`.
- **Uniswap V3** — quote via **QuoterV2** (`eth_call`), `feeTier` obligatoire.
  Swap : `exactInputSingle` enveloppé dans le `multicall(deadline, …)` du
  SwapRouter02 (qui n'a plus de deadline par appel).
- **Aerodrome** — pools stable (x³y+xy³) ou volatile (xy=k), fees par pool :
  quote via `router.getAmountsOut`, exacte pour les deux courbes.
  `priceImpactBps` calculé pour les pools volatiles seulement (le spot d'une
  courbe stable ne se lit pas dans le ratio des réserves).

Les adresses canoniques Base (`BASE_UNISWAP_V2`, `BASE_UNISWAP_V3`,
`BASE_AERODROME`, plus `BASE_WETH`/`BASE_USDC`) sont exportées et
surchargeables par options.

## Limites assumées (M3)

- **Single-hop** : le multi-hop arrivera quand une stratégie en aura besoin.
- **ERC-20 → ERC-20** uniquement (`value: 0n`) — le wrap ETH→WETH est géré en amont.
- **Taxes de tokens non modélisées** : la quote est « hors taxe token »
  (fee-on-transfer, max-tx…) — c'est le rôle du Rugpull Shield (M6).

## Tests d'intégration (opt-in)

Contre un fork anvil ou un RPC Base live, jamais en CI par défaut :

```bash
anvil --fork-url https://mainnet.base.org &   # ou un RPC Base direct
BASE_FORK_RPC_URL=http://127.0.0.1:8545 pnpm --filter @bot/dex-adapters test
```

Sans `BASE_FORK_RPC_URL`, ces tests sont skippés — la suite unitaire (client
mocké, calldata décodé et vérifié) tourne partout.
