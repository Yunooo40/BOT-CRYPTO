import { AiValidationError } from "../errors";
import type { AiProvider } from "../ports";
import type { AiRequest, AiResponse } from "../types";
import { postJson } from "./http";

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Default model. Defaults to Claude Opus 4.8 (`claude-opus-4-8`). */
  defaultModel?: string;
  /** Override for tests / gateways. Defaults to the public API. */
  baseUrl?: string;
  /** Request timeout when a request doesn't set its own. Default 30 000 ms. */
  timeoutMs?: number;
}

const JSON_SUFFIX = "\n\nRespond with a single valid JSON value and nothing else.";

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Anthropic (Claude) provider — the platform's reference LLM backend.
 *
 * Talks to `POST /v1/messages` with the `anthropic-version` header. Note the
 * Opus 4.x family rejects `temperature`/`top_p` (400), so we deliberately never
 * forward sampling params; behaviour is steered by the prompt. JSON mode is a
 * system-prompt instruction plus schema validation upstream (`completeJson`),
 * kept provider-agnostic rather than using `output_config.format`.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  readonly defaultModel: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(options: AnthropicProviderOptions) {
    this.#apiKey = options.apiKey;
    this.defaultModel = options.defaultModel ?? "claude-opus-4-8";
    this.#baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async complete(request: AiRequest): Promise<AiResponse> {
    const system =
      request.responseFormat === "json"
        ? `${request.system ?? ""}${JSON_SUFFIX}`.trim()
        : request.system;

    const body: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      max_tokens: request.maxTokens,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (system !== undefined && system.length > 0) {
      body["system"] = system;
    }

    const json = (await postJson(
      `${this.#baseUrl}/v1/messages`,
      {
        "x-api-key": this.#apiKey,
        "anthropic-version": "2023-06-01",
      },
      body,
      request.timeoutMs ?? this.#timeoutMs,
    )) as AnthropicResponse;

    const text = (json.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
    if (text.length === 0 && (json.content ?? []).length === 0) {
      throw new AiValidationError("Anthropic response contained no content", {
        context: { stopReason: json.stop_reason },
      });
    }

    return {
      text,
      model: json.model ?? (request.model ?? this.defaultModel),
      stopReason: json.stop_reason ?? "unknown",
      usage: {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      },
    };
  }
}
