import { AiValidationError } from "../errors";
import type { AiProvider } from "../ports";
import type { AiRequest, AiResponse, ProviderName } from "../types";
import { postJson } from "./http";

export interface OpenAiCompatibleOptions {
  apiKey: string;
  defaultModel: string;
  /** Chat-completions base, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  timeoutMs?: number;
}

interface ChatResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * A provider for OpenAI-style `/chat/completions` backends. OpenAI and xAI/Grok
 * share this wire format, so they're one implementation parameterized by base
 * URL, model and provider name. Unlike Anthropic, these accept `temperature`
 * and a native `response_format: json_object`.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: ProviderName;
  readonly defaultModel: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(name: ProviderName, options: OpenAiCompatibleOptions) {
    this.name = name;
    this.defaultModel = options.defaultModel;
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async complete(request: AiRequest): Promise<AiResponse> {
    const messages = [
      ...(request.system !== undefined ? [{ role: "system", content: request.system }] : []),
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const body: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      max_tokens: request.maxTokens,
      messages,
    };
    if (request.temperature !== undefined) {
      body["temperature"] = request.temperature;
    }
    if (request.responseFormat === "json") {
      body["response_format"] = { type: "json_object" };
    }

    const json = (await postJson(
      `${this.#baseUrl}/chat/completions`,
      { authorization: `Bearer ${this.#apiKey}` },
      body,
      request.timeoutMs ?? this.#timeoutMs,
    )) as ChatResponse;

    const choice = json.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== "string") {
      throw new AiValidationError(`${this.name} response contained no message content`);
    }
    return {
      text,
      model: json.model ?? request.model ?? this.defaultModel,
      stopReason: choice?.finish_reason ?? "unknown",
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  }
}
