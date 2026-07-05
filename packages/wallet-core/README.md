# @bot/wallet-core

Le cœur du Wallet Service : génération/import de wallets EVM, stockage
**chiffré AES-256-GCM**, signature (transactions, messages, typed data).
**Aucune API ne retourne, ne logge ni n'exporte une clé claire.**

L'app NestJS `wallet-service` (le « port réseau » du principe « la signature
est un service ») arrivera avec son premier consommateur (M7) ; ce package en
est le noyau.

## Modèle de sécurité

- **Clé maître** : `WALLET_MASTER_KEY` (env, validée par `@bot/config`,
  ≥ 16 caractères). Jamais stockée, jamais loggée.
- **Dérivation** : scrypt (N=2¹⁵, r=8, p=1), **salt aléatoire par enveloppe** —
  deux wallets chiffrés avec la même passphrase n'ont rien en commun.
  Un cache borné des clés dérivées (par salt) évite de payer scrypt à chaque
  signature sur le hot path.
- **Chiffrement** : AES-256-GCM, nonce 12 octets aléatoire. Authentifié : un
  bit modifié n'importe où (ou une mauvaise passphrase) → `KeystoreIntegrityError`,
  jamais de déchiffrement partiel. GCM ne distingue pas corruption/mauvaise
  clé — nous non plus, volontairement.
- **AAD = adresse du wallet** : une enveloppe recopiée sur la ligne d'un autre
  wallet refuse de s'ouvrir.
- **Format versionné** : `v1:salt:iv:ciphertext:tag` (base64) — les paramètres
  crypto peuvent évoluer sans casser l'existant.
- **Cycle de vie de la clé claire** : déchiffrée uniquement le temps d'un appel
  de signature, buffer écrasé (`fill(0)`) en `finally`, et l'adresse recouvrée
  est revérifiée contre l'enregistrement (défense en profondeur).
  Limite assumée : la chaîne hex passée à viem est une string V8, non
  effaçable — sa durée de vie est minimisée.

## API

```ts
import { WalletService, DrizzleWalletRepository, InMemoryWalletRepository } from "@bot/wallet-core";

const { repository, close } = DrizzleWalletRepository.connect(env.DATABASE_URL);
const wallets = new WalletService({ repository, masterKey: env.WALLET_MASTER_KEY });

const w = await wallets.createWallet("sniper-1"); // { id, address, label, … } — jamais la clé
await wallets.importWallet("0x…64 hex…", "importé");

const raw = await wallets.signTransaction(w.id, tx); // TransactionSerializable viem
const sig = await wallets.signMessage(w.id, "gm");
const typed = await wallets.signTypedData(w.id, typedData);
```

`InMemoryWalletRepository` sert aux tests et au paper trading ;
`DrizzleWalletRepository` persiste dans PostgreSQL (table `wallets`, migration
dans [`drizzle/0001_wallets.sql`](drizzle/0001_wallets.sql), schéma
multi-tenant-ready via `tenant_id`).

## Erreurs

- `WalletNotFoundError` (`DomainError`) — id/adresse inconnus.
- `KeystoreIntegrityError` (`DomainError`) — enveloppe corrompue, rejouée
  ailleurs, ou mauvaise clé maître. Non retryable, à traiter comme un incident.

## Tests

- Unitaires : round-trip, tampering champ par champ, AAD, versions ; signatures
  vérifiées par recovery (message, EIP-1559, typed data) contre le compte de
  test public d'anvil.
- Intégration : `DrizzleWalletRepository` contre PostgreSQL — skippée si la DB
  est injoignable, exigée quand `DATABASE_URL` est défini (CI).
