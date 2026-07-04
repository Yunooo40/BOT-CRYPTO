import { OpenAiCompatibleProvider } from "./openai-compatible";

export interface OpenAiProviderOptions {
  apiKey: string;
  /** Default model. Defaults to `gpt-4o`. */
  defaultModel?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/** OpenAI provider (`/chat/completions`). Skeleton over the shared implementation. */
export class OpenAiProvider extends OpenAiCompatibleProvider {
  constructor(options: OpenAiProviderOptions) {
    super("openai", {
      apiKey: options.apiKey,
      defaultModel: options.defaultModel ?? "gpt-4o",
      baseUrl: options.baseUrl ?? "https://api.openai.com/v1",
      timeoutMs: options.timeoutMs,
    });
  }
}
