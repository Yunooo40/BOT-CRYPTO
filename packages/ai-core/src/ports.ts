import type { AiRequest, AiResponse, ProviderName } from "./types";

/**
 * A single LLM backend. The one method every provider implements; the engine,
 * the registry and the fake all speak to this. Pure interface — no shared base,
 * no bus, no chain.
 */
export interface AiProvider {
  readonly name: ProviderName;
  /** The model used when a request omits `model`. */
  readonly defaultModel: string;
  complete(request: AiRequest): Promise<AiResponse>;
}
