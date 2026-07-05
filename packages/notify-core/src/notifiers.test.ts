import { InfraError } from "@bot/errors";
import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "./http";
import type { NotificationMessage } from "./message";
import {
  DiscordNotifier,
  EmailNotifier,
  TelegramNotifier,
  WebhookNotifier,
  type EmailTransport,
} from "./notifiers";

const message: NotificationMessage = {
  title: "Bought token",
  body: "BUY settled",
  severity: "success",
  fields: [{ label: "Token", value: "0xabc" }],
  link: "https://basescan.org/tx/0x1",
};

function okHttp(): {
  http: HttpClient;
  calls: Array<{ url: string; body: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const http: HttpClient = {
    post: vi.fn(async (url, body, headers) => {
      calls.push({ url, body, headers });
      return { status: 200, body: "ok" };
    }),
  };
  return { http, calls };
}

describe("TelegramNotifier", () => {
  it("posts HTML sendMessage with token and chat id in the URL/payload", async () => {
    const { http, calls } = okHttp();
    await new TelegramNotifier({ http, botToken: "T0K", chatId: "42" }).send(message);
    expect(calls[0]?.url).toBe("https://api.telegram.org/botT0K/sendMessage");
    const payload = JSON.parse(calls[0]!.body);
    expect(payload.chat_id).toBe("42");
    expect(payload.parse_mode).toBe("HTML");
    expect(payload.text).toContain("<b>Bought token</b>");
    expect(payload.text).toContain("Token:");
  });

  it("escapes HTML in content", async () => {
    const { http, calls } = okHttp();
    await new TelegramNotifier({ http, botToken: "T", chatId: "1" }).send({
      ...message,
      title: "<script>",
    });
    expect(JSON.parse(calls[0]!.body).text).toContain("&lt;script&gt;");
  });
});

describe("DiscordNotifier", () => {
  it("posts an embed with a severity colour", async () => {
    const { http, calls } = okHttp();
    await new DiscordNotifier({ http, webhookUrl: "https://discord/wh" }).send(message);
    const embed = JSON.parse(calls[0]!.body).embeds[0];
    expect(embed.color).toBe(0x2ecc71); // success
    expect(embed.fields[0]).toMatchObject({ name: "Token", value: "0xabc" });
  });
});

describe("WebhookNotifier", () => {
  it("posts JSON without a signature when no secret", async () => {
    const { http, calls } = okHttp();
    await new WebhookNotifier({ http, url: "https://hook" }).send(message);
    expect(calls[0]?.headers["x-signature"]).toBeUndefined();
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ severity: "success" });
  });

  it("signs the body when a secret and signer are provided", async () => {
    const { http, calls } = okHttp();
    const sign = vi.fn(() => "sig123");
    await new WebhookNotifier({ http, url: "https://hook", secret: "s", sign }).send(message);
    expect(sign).toHaveBeenCalledWith("s", calls[0]!.body);
    expect(calls[0]?.headers["x-signature"]).toBe("sig123");
  });
});

describe("EmailNotifier", () => {
  it("renders subject and text to the transport", async () => {
    const sent: { subject: string; text: string }[] = [];
    const transport: EmailTransport = { sendMail: async (m) => void sent.push(m) };
    await new EmailNotifier({ transport }).send(message);
    expect(sent[0]?.subject).toBe("[SUCCESS] Bought token");
    expect(sent[0]?.text).toContain("Token: 0xabc");
  });
});

describe("HTTP status classification", () => {
  it("throws InfraError on 5xx (retryable) and plain Error on 4xx", async () => {
    const server: HttpClient = { post: async () => ({ status: 503, body: "down" }) };
    await expect(
      new DiscordNotifier({ http: server, webhookUrl: "u" }).send(message),
    ).rejects.toBeInstanceOf(InfraError);
    const client: HttpClient = { post: async () => ({ status: 400, body: "bad" }) };
    const err = await new DiscordNotifier({ http: client, webhookUrl: "u" })
      .send(message)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(InfraError);
  });
});
