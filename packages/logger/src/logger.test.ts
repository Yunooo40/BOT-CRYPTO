import type { DestinationStream } from "pino";
import { describe, expect, it } from "vitest";
import { createLogger } from "./index";

/** Capture raw log lines by feeding pino a minimal destination stream. */
function capture(): { lines: string[]; stream: DestinationStream } {
  const lines: string[] = [];
  return {
    lines,
    stream: {
      write(chunk: string) {
        lines.push(chunk);
      },
    },
  };
}

describe("createLogger", () => {
  it("emits structured JSON with the service name and message", () => {
    const { lines, stream } = capture();
    const log = createLogger({ name: "scanner", level: "debug", destination: stream });

    log.info("token detected");

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.name).toBe("scanner");
    expect(entry.msg).toBe("token detected");
    expect(entry.level).toBe(30); // pino numeric level for "info"
  });

  it("suppresses messages below the configured level", () => {
    const { lines, stream } = capture();
    const log = createLogger({ level: "info", destination: stream });

    log.debug("too quiet to hear");

    expect(lines).toHaveLength(0);
  });

  it("redacts sensitive fields at the top level and one level deep", () => {
    const { lines, stream } = capture();
    const log = createLogger({ destination: stream });

    log.info({ privateKey: "0xdeadbeef", wallet: { mnemonic: "twelve secret words" } }, "signing");

    const entry = JSON.parse(lines[0]!);
    expect(entry.privateKey).toBe("[REDACTED]");
    expect(entry.wallet.mnemonic).toBe("[REDACTED]");
  });
});
