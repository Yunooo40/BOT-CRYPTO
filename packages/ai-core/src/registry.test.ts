import { describe, expect, it } from "vitest";
import { AiValidationError } from "./errors";
import { createProviders, ProviderRegistry } from "./registry";

describe("createProviders / ProviderRegistry", () => {
  it("builds only providers whose key is present", () => {
    const providers = createProviders({ ANTHROPIC_API_KEY: "a", GROK_API_KEY: "g" });
    expect([...providers.keys()].sort()).toEqual(["anthropic", "grok"]);
  });

  it("builds nothing when no keys are set", () => {
    expect(createProviders({}).size).toBe(0);
  });

  it("resolves a model reference to its provider", () => {
    const registry = ProviderRegistry.fromEnv({ OPENAI_API_KEY: "k" });
    const provider = registry.resolveModel({ provider: "openai", model: "gpt-4o" });
    expect(provider.name).toBe("openai");
  });

  it("throws AiValidationError for an unconfigured provider", () => {
    const registry = ProviderRegistry.fromEnv({ ANTHROPIC_API_KEY: "a" });
    expect(() => registry.get("gemini")).toThrow(AiValidationError);
    expect(registry.has("gemini")).toBe(false);
  });
});
