import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "./gemini";
import { OpenAiProvider } from "./openai";
import { GrokProvider } from "./grok";

function mockFetch(body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

const req = { system: "sys", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 50 };

describe("OpenAI-compatible providers", () => {
  const chatBody = {
    choices: [{ message: { content: "answer" }, finish_reason: "stop" }],
    model: "gpt-4o",
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  };

  it("maps a chat completion and forwards temperature + json format", async () => {
    const fetchFn = mockFetch(chatBody);
    const provider = new OpenAiProvider({ apiKey: "k" });
    const res = await provider.complete({ ...req, temperature: 0.5, responseFormat: "json" });
    expect(res.text).toBe("answer");
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 2 });

    const body = JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.5);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
  });

  it("Grok reuses the same wire format and hits the xAI base", async () => {
    const fetchFn = mockFetch(chatBody);
    const provider = new GrokProvider({ apiKey: "k" });
    const res = await provider.complete(req);
    expect(res.text).toBe("answer");
    expect((fetchFn.mock.calls[0] as [string, RequestInit])[0]).toContain("x.ai");
  });
});

describe("GeminiProvider", () => {
  it("maps generateContent shape and passes the key as a query param", async () => {
    const fetchFn = mockFetch({
      candidates: [{ content: { parts: [{ text: "gem" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 },
    });
    const provider = new GeminiProvider({ apiKey: "secret" });
    const res = await provider.complete(req);
    expect(res.text).toBe("gem");
    expect(res.usage).toEqual({ inputTokens: 4, outputTokens: 1 });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("key=secret");
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.contents[0].role).toBe("user");
  });
});
