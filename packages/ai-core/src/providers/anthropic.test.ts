import { afterEach, describe, expect, it, vi } from "vitest";
import { AiInfraError, AiValidationError } from "../errors";
import { AnthropicProvider } from "./anthropic";

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

const okBody = {
  content: [{ type: "text", text: "hello" }],
  stop_reason: "end_turn",
  model: "claude-opus-4-8",
  usage: { input_tokens: 12, output_tokens: 3 },
};

afterEach(() => vi.unstubAllGlobals());

describe("AnthropicProvider", () => {
  const provider = new AnthropicProvider({ apiKey: "sk-test" });
  const req = { system: "you are a bot", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 100 };

  it("maps a successful response and sends the version header", async () => {
    const fetchFn = mockFetch(200, okBody);
    const res = await provider.complete(req);
    expect(res.text).toBe("hello");
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    expect(res.model).toBe("claude-opus-4-8");

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["x-api-key"]).toBe("sk-test");
  });

  it("never forwards temperature (Opus 4.x rejects it)", async () => {
    const fetchFn = mockFetch(200, okBody);
    await provider.complete({ ...req, temperature: 0.7 });
    const body = JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("temperature");
    expect(body.model).toBe("claude-opus-4-8");
  });

  it("appends a JSON instruction in json mode", async () => {
    const fetchFn = mockFetch(200, okBody);
    await provider.complete({ ...req, responseFormat: "json" });
    const body = JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.system).toContain("valid JSON");
  });

  it("maps 429 to a retryable AiInfraError", async () => {
    mockFetch(429, { error: "rate limited" });
    await expect(provider.complete(req)).rejects.toBeInstanceOf(AiInfraError);
  });

  it("maps 400 to a non-retryable AiValidationError", async () => {
    mockFetch(400, { error: "bad" });
    await expect(provider.complete(req)).rejects.toBeInstanceOf(AiValidationError);
  });
});
