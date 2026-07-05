import { assertOkStatus, type HttpClient } from "./http";
import type { NotificationMessage, Notifier, Severity } from "./message";

/** Emoji prefix per severity — a cheap, universal visual cue across channels. */
const SEVERITY_EMOJI: Record<Severity, string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  critical: "🚨",
};

/** Discord embed colours per severity (decimal RGB). */
const SEVERITY_COLOR: Record<Severity, number> = {
  info: 0x3498db,
  success: 0x2ecc71,
  warning: 0xf1c40f,
  critical: 0xe74c3c,
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- Telegram -------------------------------------------------------------

export interface TelegramNotifierOptions {
  http: HttpClient;
  botToken: string;
  chatId: string;
}

/** Telegram Bot API `sendMessage`, HTML parse mode. */
export class TelegramNotifier implements Notifier {
  readonly channel = "telegram" as const;
  readonly #http: HttpClient;
  readonly #botToken: string;
  readonly #chatId: string;

  constructor(options: TelegramNotifierOptions) {
    this.#http = options.http;
    this.#botToken = options.botToken;
    this.#chatId = options.chatId;
  }

  async send(message: NotificationMessage): Promise<void> {
    const lines = [
      `${SEVERITY_EMOJI[message.severity]} <b>${escapeHtml(message.title)}</b>`,
      escapeHtml(message.body),
      ...(message.fields ?? []).map((f) => `<b>${escapeHtml(f.label)}:</b> ${escapeHtml(f.value)}`),
    ];
    if (message.link !== undefined) {
      lines.push(`<a href="${escapeHtml(message.link)}">details</a>`);
    }
    const url = `https://api.telegram.org/bot${this.#botToken}/sendMessage`;
    const payload = JSON.stringify({
      chat_id: this.#chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    const res = await this.#http.post(url, payload, { "content-type": "application/json" });
    assertOkStatus(res.status, this.channel, res.body);
  }
}

// --- Discord --------------------------------------------------------------

export interface DiscordNotifierOptions {
  http: HttpClient;
  webhookUrl: string;
}

/** Discord webhook with a coloured embed. */
export class DiscordNotifier implements Notifier {
  readonly channel = "discord" as const;
  readonly #http: HttpClient;
  readonly #webhookUrl: string;

  constructor(options: DiscordNotifierOptions) {
    this.#http = options.http;
    this.#webhookUrl = options.webhookUrl;
  }

  async send(message: NotificationMessage): Promise<void> {
    const embed = {
      title: `${SEVERITY_EMOJI[message.severity]} ${message.title}`,
      description: message.body,
      color: SEVERITY_COLOR[message.severity],
      ...(message.link !== undefined ? { url: message.link } : {}),
      ...(message.fields !== undefined
        ? { fields: message.fields.map((f) => ({ name: f.label, value: f.value, inline: true })) }
        : {}),
    };
    const res = await this.#http.post(this.#webhookUrl, JSON.stringify({ embeds: [embed] }), {
      "content-type": "application/json",
    });
    assertOkStatus(res.status, this.channel, res.body);
  }
}

// --- Generic webhook ------------------------------------------------------

export interface WebhookNotifierOptions {
  http: HttpClient;
  url: string;
  /** Optional HMAC-SHA256 secret; when set, signs the body in `x-signature`. */
  secret?: string;
  /** Injected signer (node:crypto in prod) so the package stays dependency-free. */
  sign?: (secret: string, body: string) => string;
}

/** Generic JSON webhook, optionally HMAC-signed. */
export class WebhookNotifier implements Notifier {
  readonly channel = "webhook" as const;
  readonly #http: HttpClient;
  readonly #url: string;
  readonly #secret: string | undefined;
  readonly #sign: ((secret: string, body: string) => string) | undefined;

  constructor(options: WebhookNotifierOptions) {
    this.#http = options.http;
    this.#url = options.url;
    this.#secret = options.secret;
    this.#sign = options.sign;
  }

  async send(message: NotificationMessage): Promise<void> {
    const body = JSON.stringify({
      title: message.title,
      body: message.body,
      severity: message.severity,
      fields: message.fields ?? [],
      ...(message.link !== undefined ? { link: message.link } : {}),
    });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.#secret !== undefined && this.#sign !== undefined) {
      headers["x-signature"] = this.#sign(this.#secret, body);
    }
    const res = await this.#http.post(this.#url, body, headers);
    assertOkStatus(res.status, this.channel, res.body);
  }
}

// --- Email ----------------------------------------------------------------

/** SMTP-agnostic email port. A real transport is wired in later (M11 ships a log impl). */
export interface EmailTransport {
  sendMail(mail: { subject: string; text: string }): Promise<void>;
}

export interface EmailNotifierOptions {
  transport: EmailTransport;
}

/** Renders a message to plain text and hands it to an injected transport. */
export class EmailNotifier implements Notifier {
  readonly channel = "email" as const;
  readonly #transport: EmailTransport;

  constructor(options: EmailNotifierOptions) {
    this.#transport = options.transport;
  }

  async send(message: NotificationMessage): Promise<void> {
    const lines = [
      message.body,
      "",
      ...(message.fields ?? []).map((f) => `${f.label}: ${f.value}`),
      ...(message.link !== undefined ? ["", message.link] : []),
    ];
    await this.#transport.sendMail({
      subject: `[${message.severity.toUpperCase()}] ${message.title}`,
      text: lines.join("\n"),
    });
  }
}
