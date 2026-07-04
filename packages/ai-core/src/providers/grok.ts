import { OpenAiCompatibleProvider } from "./openai-compatible";

export interface GrokProviderOptions {
  apiKey: string;
  /** Default model. Defaults to `grok-2-latest`. */
  defaultModel?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/** xAI/Grok provider — OpenAI-compatible API. Skeleton over the shared implementation. */
export class GrokProvider extends OpenAiCompatibleProvider {
  constructor(options: GrokProviderOptions) {
    super("grok", {
      apiKey: options.apiKey,
      defaultModel: options.defaultModel ?? "grok-2-latest",
      baseUrl: options.baseUrl ?? "https://api.x.ai/v1",
      timeoutMs: options.timeoutMs,
    });
  }
}
