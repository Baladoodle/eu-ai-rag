/**
 * Pino logger instance.
 *
 * Why pino: it's the fastest Node logger, emits structured JSON by default,
 * and the Vercel log drain plays well with it. We use level-aware logging so
 * dev can be noisy and prod stays skim-able.
 *
 * Format:
 *   - In dev (`NODE_ENV !== "production"`): pretty-printed, colorized, easy
 *     to read in a terminal.
 *   - In prod: raw JSON, one line per event, Vercel-friendly.
 *
 * Level: defaults to `info`. Override via `LOG_LEVEL` env var
 * (`trace` | `debug` | `info` | `warn` | `error`).
 *
 * Usage:
 *   import { log } from "@/lib/logger";
 *   log.info({ sessionId, msgCount }, "chat.start");
 *   log.child({ requestId }).debug("retrieval.candidates", { count });
 */
import pino, { type Logger } from "pino";

const isProd = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL ?? (isProd ? "info" : "debug");

/**
 * Build the pino options for the current environment.
 *
 * Why a function: keeps the env-detection logic in one place and makes it
 * trivial to unit-test the config shape without importing the live module.
 */
function buildOptions() {
  if (isProd) {
    // Prod: raw JSON, no transport. Vercel handles pretty-printing.
    return { level };
  }

  // Dev: pipe through pino-pretty for human-readable output. We use a
  // dynamic transport so we don't pay the cost of starting the worker
  // thread in production.
  return {
    level,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    },
  };
}

export const log: Logger = pino(buildOptions());
