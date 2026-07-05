import { AiValidationError } from "../errors";
import type { AiProvider } from "../ports";
import type { AiRequest, AiResponse } from "../types";
import { postJson } from "./http";

export interface GeminiProviderOptions {
  apiKey: string;
  /** Default model. Defaults to `gemini-2.0-flash`. */
  defaultModel?: string;
  /** Generative Language API base. Defaults to the public endpoint. */
  baseUrl?: string;
  timeoutMs?: number;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Google Gemini provider (`generateContent`). Gemini's shape differs from the
 * others: turns are `contents` with `role: "user" | "model"`, the system prompt
 * is `systemInstruction`, and the key rides in a query param. Kept a skeleton
 * conforming to the port; the mapping is exercised by unit tests with a mocked
 * transport.
 */
export class GeminiProvider implements AiProvider {
  readonly name = "gemini" as const;
  readonly defaultModel: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(options: GeminiProviderOptions) {
    this.#apiKey = options.apiKey;
    this.defaultModel = options.defaultModel ?? "gemini-2.0-flash";
    this.#baseUrl = options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async complete(request: AiRequest): Promise<AiResponse> {
    const model = request.model ?? this.defaultModel;
    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.responseFormat === "json" ? { responseMimeType: "application/json" } : {}),
      },
    };
    if (request.system !== undefined) {
      body["systemInstruction"] = { parts: [{ text: request.system }] };
    }

    const json = (await postJson(
      `${this.#baseUrl}/models/${model}:generateContent?key=${this.#apiKey}`,
      {},
      body,
      request.timeoutMs ?? this.#timeoutMs,
    )) as GeminiResponse;

    const candidate = json.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .map((p) => p.text)
      .filter((t): t is string => typeof t === "string")
      .join("");
    if (text.length === 0) {
      throw new AiValidationError("Gemini response contained no content", {
        context: { finishReason: candidate?.finishReason },
      });
    }
    return {
      text,
      model,
      stopReason: candidate?.finishReason ?? "unknown",
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
