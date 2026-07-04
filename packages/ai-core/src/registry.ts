import { AiValidationError } from "./errors";
import type { AiProvider } from "./ports";
import { AnthropicProvider } from "./providers/anthropic";
import { GeminiProvider } from "./providers/gemini";
import { GrokProvider } from "./providers/grok";
import { OpenAiProvider } from "./providers/openai";
import type { ModelRef, ProviderName } from "./types";

/** The slice of `@bot/config` env this module reads. Kept structural to stay decoupled. */
export interface AiProviderKeys {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GROK_API_KEY?: string;
}

/**
 * Build every provider whose API key is present in the environment. A provider
 * without a key is simply absent from the returned map — construction never
 * fails, matching the "AI is a capability, not a boot prerequisite" rule.
 */
export function createProviders(keys: AiProviderKeys): Map<ProviderName, AiProvider> {
  const providers = new Map<ProviderName, AiProvider>();
  if (keys.ANTHROPIC_API_KEY !== undefined) {
    providers.set("anthropic", new AnthropicProvider({ apiKey: keys.ANTHROPIC_API_KEY }));
  }
  if (keys.OPENAI_API_KEY !== undefined) {
    providers.set("openai", new OpenAiProvider({ apiKey: keys.OPENAI_API_KEY }));
  }
  if (keys.GEMINI_API_KEY !== undefined) {
    providers.set("gemini", new GeminiProvider({ apiKey: keys.GEMINI_API_KEY }));
  }
  if (keys.GROK_API_KEY !== undefined) {
    providers.set("grok", new GrokProvider({ apiKey: keys.GROK_API_KEY }));
  }
  return providers;
}

/**
 * Routes a {@link ModelRef} to the right provider. A tiny lookup, but it keeps
 * "which provider serves this model" in one place and fails loudly on a
 * provider that wasn't configured (no key).
 */
export class ProviderRegistry {
  readonly #providers: Map<ProviderName, AiProvider>;

  constructor(providers: Map<ProviderName, AiProvider>) {
    this.#providers = providers;
  }

  static fromEnv(keys: AiProviderKeys): ProviderRegistry {
    return new ProviderRegistry(createProviders(keys));
  }

  has(provider: ProviderName): boolean {
    return this.#providers.has(provider);
  }

  get(provider: ProviderName): AiProvider {
    const found = this.#providers.get(provider);
    if (found === undefined) {
      throw new AiValidationError(`AI provider "${provider}" is not configured`, {
        context: { provider },
      });
    }
    return found;
  }

  /** Resolve a model reference to its provider. */
  resolveModel(ref: ModelRef): AiProvider {
    return this.get(ref.provider);
  }
}
