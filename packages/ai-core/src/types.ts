/** The providers this module can talk to. Concrete model IDs live in each provider. */
export type ProviderName = "anthropic" | "openai" | "gemini" | "grok";

/** A provider-qualified model reference — the routing key for the registry. */
export interface ModelRef {
  provider: ProviderName;
  /** Provider-native model id (e.g. `claude-opus-4-8`). */
  model: string;
}

/** One conversational turn. Content is plain text — this module is text-in/text-out. */
export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * A completion request. Deterministic, provider-agnostic: the engine and each
 * provider translate this into the wire format. `model` overrides the provider's
 * default; `responseFormat: "json"` asks the model to answer with JSON only
 * (validated by {@link AiEngine.completeJson}).
 */
export interface AiRequest {
  system?: string;
  messages: AiMessage[];
  model?: string;
  maxTokens: number;
  /**
   * Sampling temperature. Ignored by providers/models that reject it (e.g.
   * Anthropic's Opus 4.x family, which 400s on `temperature`).
   */
  temperature?: number;
  responseFormat?: "text" | "json";
  /** Per-request timeout in ms. The engine also enforces its own default. */
  timeoutMs?: number;
}

/** Token accounting for a single completion. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

/** A completion result, normalized across providers. */
export interface AiResponse {
  text: string;
  /** The model that actually produced the answer. */
  model: string;
  /** Why generation stopped (provider-native string, normalized where cheap). */
  stopReason: string;
  usage: AiUsage;
}
