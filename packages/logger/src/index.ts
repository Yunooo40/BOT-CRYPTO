import { pino, type DestinationStream, type Logger, type LoggerOptions } from "pino";

export type { Logger } from "pino";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface CreateLoggerOptions {
  /** Minimum level to emit. Defaults to "info". */
  level?: LogLevel;
  /** Service name attached to every line as `name` (e.g. "scanner", "engine"). */
  name?: string;
  /** Human-readable colored output for local dev. Defaults to false (JSON). */
  pretty?: boolean;
  /** Override the output stream. Used in tests to capture log lines. */
  destination?: DestinationStream;
}

/**
 * Fields that must never reach the logs, at the top level or one nesting deep.
 * A trading bot handles private keys and mnemonics constantly; redacting them
 * here means no individual `log.info(wallet)` call can leak one by accident.
 */
const REDACT_PATHS = [
  "privateKey",
  "*.privateKey",
  "mnemonic",
  "*.mnemonic",
  "secret",
  "*.secret",
  "seed",
  "*.seed",
];

/**
 * Build a configured pino logger. Structured JSON by default (one object per
 * line, ready for log shippers); opt into `pretty` for local development.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { level = "info", name, pretty = false, destination } = options;

  const base: LoggerOptions = {
    level,
    ...(name !== undefined ? { name } : {}),
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  };

  if (destination !== undefined) {
    return pino(base, destination);
  }

  if (pretty) {
    return pino({
      ...base,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
      },
    });
  }

  return pino(base);
}
