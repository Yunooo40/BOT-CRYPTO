import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiEngine } from "./engine";
import { AiInfraError, AiValidationError } from "./errors";
import { FakeProvider } from "./providers/fake";

const noSleep = async (): Promise<void> => undefined;
const req = { messages: [{ role: "user" as const, content: "hi" }], maxTokens: 64 };

describe("AiEngine.complete", () => {
  it("retries a retryable infra error and then succeeds", async () => {
    const primary = new FakeProvider({
      replies: [new AiInfraError("503"), new AiInfraError("503"), "recovered"],
    });
    const engine = new AiEngine({ primary, maxRetries: 2, sleep: noSleep });
    const res = await engine.complete(req);
    expect(res.text).toBe("recovered");
    expect(primary.calls).toBe(3);
  });

  it("does not retry a validation error", async () => {
    const primary = new FakeProvider({ replies: [new AiValidationError("bad request")] });
    const engine = new AiEngine({ primary, maxRetries: 2, sleep: noSleep });
    await expect(engine.complete(req)).rejects.toBeInstanceOf(AiValidationError);
    expect(primary.calls).toBe(1);
  });

  it("falls back to the secondary provider on persistent infra failure", async () => {
    const primary = new FakeProvider({ replies: [new AiInfraError("down")] });
    const fallback = new FakeProvider({ name: "openai", replies: ["from fallback"] });
    const engine = new AiEngine({ primary, fallback, maxRetries: 0, sleep: noSleep });
    const res = await engine.complete(req);
    expect(res.text).toBe("from fallback");
  });

  it("does not fall back on a validation error", async () => {
    const primary = new FakeProvider({ replies: [new AiValidationError("nope")] });
    const fallback = new FakeProvider({ name: "openai", replies: ["unused"] });
    const engine = new AiEngine({ primary, fallback, maxRetries: 0, sleep: noSleep });
    await expect(engine.complete(req)).rejects.toBeInstanceOf(AiValidationError);
    expect(fallback.calls).toBe(0);
  });
});

describe("AiEngine.completeJson", () => {
  const schema = z.object({ score: z.number(), verdict: z.string() });

  it("parses and validates JSON output", async () => {
    const primary = new FakeProvider({ replies: ['{"score": 7, "verdict": "risky"}'] });
    const engine = new AiEngine({ primary, sleep: noSleep });
    const out = await engine.completeJson(req, schema);
    expect(out).toEqual({ score: 7, verdict: "risky" });
  });

  it("strips ```json fences before parsing", async () => {
    const primary = new FakeProvider({
      replies: ['```json\n{"score": 1, "verdict": "ok"}\n```'],
    });
    const engine = new AiEngine({ primary, sleep: noSleep });
    const out = await engine.completeJson(req, schema);
    expect(out.score).toBe(1);
  });

  it("throws AiValidationError on non-JSON output", async () => {
    const primary = new FakeProvider({ replies: ["not json at all"] });
    const engine = new AiEngine({ primary, sleep: noSleep });
    await expect(engine.completeJson(req, schema)).rejects.toBeInstanceOf(AiValidationError);
  });

  it("throws AiValidationError when JSON does not match the schema", async () => {
    const primary = new FakeProvider({ replies: ['{"score": "high"}'] });
    const engine = new AiEngine({ primary, sleep: noSleep });
    await expect(engine.completeJson(req, schema)).rejects.toBeInstanceOf(AiValidationError);
  });

  it("requests JSON response format from the provider", async () => {
    let seenFormat: string | undefined;
    const primary = new FakeProvider({
      replies: [
        (r) => {
          seenFormat = r.responseFormat;
          return "{}";
        },
      ],
    });
    const engine = new AiEngine({ primary, sleep: noSleep });
    await engine.completeJson(req, z.object({}));
    expect(seenFormat).toBe("json");
  });
});
