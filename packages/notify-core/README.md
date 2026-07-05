# @bot/notify-core

Transforme les événements du bus (trades, risque) en notifications sortantes
multi-canal — **Telegram, Discord, webhook, email** — avec formatage cohérent,
routage par sévérité, dédup, rate-limit et retry. Chaque canal est un port ;
aucun n'est un point de couplage dur.

## Ports & modèle

- `NotificationMessage` : `title`, `body`, `severity`
  (`info`/`success`/`warning`/`critical`), `fields`, `link?`, `dedupeKey?`.
- `Notifier { channel, send(message) }` — quatre implémentations. `send` rejette
  en cas d'échec pour que le dispatcher retente.
- `HttpClient` injecté partout (défaut `fetch`) : aucun test ne touche le réseau,
  aucune dépendance HTTP lourde.

## Les quatre notifiers

| Canal      | Rendu                                                                     |
| ---------- | ------------------------------------------------------------------------- |
| `telegram` | Bot API `sendMessage`, HTML, échappé                                      |
| `discord`  | Webhook, embed coloré par sévérité                                        |
| `webhook`  | POST JSON générique, signature HMAC optionnelle (signer injecté)          |
| `email`    | Port `EmailTransport` (SMTP-agnostique) — impl. réelle branchée plus tard |

## Formatage

`formatEvent(event) → NotificationMessage | undefined` — mapping typé :
`trade.executed` → succès (token/montants/tx + lien explorer), `trade.failed`
→ warning ou critical selon `retryable`, `risk.assessed danger` → critical.
Les autres types (et un `risk.assessed` non-danger) renvoient `undefined` :
pas de bruit. Le rendu par canal est séparé du contenu.

## Dispatcher

`NotificationDispatcher.dispatch(message, rule?)` :

- **Routage** par règle `{ channels, minSeverity }`.
- **Dédup** par `dedupeKey` sur une fenêtre TTL (un événement rejoué ne
  double-notifie pas).
- **Rate-limit** par canal (token bucket).
- **Retry** des `InfraError` (réseau, HTTP 5xx/429) avec backoff ; les 4xx sont
  terminales. Un canal en échec n'empêche jamais les autres.

`attachNotifications({ bus, dispatcher })` abonne le tout au bus
(`trade.executed`, `trade.failed`, `risk.assessed` par défaut).

## Config (`@bot/config`, tous optionnels)

`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK_URL`,
`NOTIFY_WEBHOOK_URL` / `NOTIFY_WEBHOOK_SECRET`. Un canal sans config est
inactif. Secrets jamais loggés.

## Tests

- Quatre notifiers (payloads mockés par canal, échappement HTML, HMAC).
- Classification HTTP (5xx retryable → `InfraError`, 4xx terminal).
- Formatage par type d'événement (succès/échec/danger/ignoré).
- Dispatcher : routage par sévérité, dédup, rate-limit (horloge mockée),
  retry, isolation des canaux.
- Pipeline bus `trade.executed → notifier appelé`.
