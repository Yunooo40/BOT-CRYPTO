import type { AiProvider } from "../ports";
import type { AiRequest, AiResponse, ProviderName } from "../types";

/** A scripted reply, or a function that computes one from the request. */
export type FakeReply = string | Error | ((request: AiRequest) => AiResponse | string | Error);

export interface FakeProviderOptions {
  name?: ProviderName;
  defaultModel?: string;
  /** Replies returned in order across calls; the last one repeats once exhausted. */
  replies?: FakeReply[];
}

/**
 * A deterministic in-memory provider for tests and paper trading — no network.
 * Returns scripted replies (or throws scripted errors) so the engine's retry,
 * timeout, fallback and JSON paths can be driven without hitting a real API.
 */
export class FakeProvider implements AiProvider {
  readonly name: ProviderName;
  readonly defaultModel: string;
  readonly #replies: FakeReply[];
  #calls = 0;

  constructor(options: FakeProviderOptions = {}) {
    this.name = options.name ?? "anthropic";
    this.defaultModel = options.defaultModel ?? "fake-model";
    this.#replies = options.replies ?? ["ok"];
  }

  /** Number of times {@link complete} has been invoked — for asserting retries. */
  get calls(): number {
    return this.#calls;
  }

  async complete(request: AiRequest): Promise<AiResponse> {
    const index = Math.min(this.#calls, this.#replies.length - 1);
    this.#calls += 1;
    const reply = this.#replies[index] ?? "ok";
    const value = typeof reply === "function" ? reply(request) : reply;
    if (value instanceof Error) {
      throw value;
    }
    if (typeof value === "string") {
      return {
        text: value,
        model: request.model ?? this.defaultModel,
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    return value;
  }
}
