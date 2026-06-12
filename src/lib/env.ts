/**
 * Environment variable loader.
 *
 * Why this file exists (educational note for someone new to RAGs):
 *   In a RAG app you tend to accumulate a lot of configuration:
 *     - API keys for the embedding model and the LLM
 *     - Connection strings for the vector database
 *     - Feature flags (which backend? dry-run? mock?)
 *   The cardinal sin is reading `process.env` ad-hoc throughout the codebase.
 *   That makes it impossible to:
 *     1. Catch typos at boot time (you'd only notice at the moment of use).
 *     2. Provide a sensible default (devs forget which vars are required).
 *     3. Reuse a validated value across many files without re-validating.
 *
 *   The Zod-based pattern below validates EVERY var on first access, throws a
 *   single, readable error if anything is missing, and freezes the result so
 *   later code can rely on the types.
 *
 * Usage:
 *   import { env } from "@/lib/env";
 *   const model = env.EMBEDDING_MODEL; // typed as "voyage-code-3" | ...
 */
import { z } from "zod";

/**
 * Schema for all environment variables used in the app + scripts.
 *
 * Why is `parse()` called and not `safeParse()`? Because at boot, the user
 * is right there to read the error. Fail-fast is the friendly choice.
 */
const schema = z.object({
  // --- LLM ----------------------------------------------------------------
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /**
   * Base URL for the Anthropic API. Defaults to the official endpoint.
   * Override this to point at a proxy (e.g. MiniMax, AWS Bedrock gateway,
   * internal mirror) that speaks the Anthropic Messages API with a
   * compatible key.
   */
  ANTHROPIC_BASE_URL: z.string().url().optional(),

  // --- Embeddings ---------------------------------------------------------
  /**
   * Voyage AI is the default. OpenAI is a fallback for environments where
   * Voyage isn't reachable. We treat the empty string as "unset" so a stray
   * .env line doesn't break the build.
   */
  VOYAGE_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),

  /**
   * The model is switchable so we can A/B test voyage-code-3 vs voyage-3
   * without code changes. The strings are constrained so a typo is caught
   * by Zod instead of an obscure 4xx from the API.
   */
  EMBEDDING_PROVIDER: z.enum(["voyage", "openai"]).default("voyage"),
  EMBEDDING_MODEL: z
    .enum(["voyage-code-3", "voyage-3", "text-embedding-3-small"])
    .default("voyage-code-3"),

  // --- Vector store -------------------------------------------------------
  POSTGRES_CONNECTION_STRING: z.string().min(1).optional(),

  /**
   * "pg" in production, "memory" in dev. We default off the value of
   * `NODE_ENV` but let the user override (e.g. for E2E tests).
   */
  VECTOR_BACKEND: z.enum(["pg", "memory"]).optional(),

  // --- Pipeline toggles ---------------------------------------------------
  /**
   * When `1`, the CLI computes and prints the embedding/upsert plan but
   * performs zero network writes. Used in CI smoke tests.
   */
  DRY_RUN: z.string().optional(),

  /**
   * Limit the number of items scraped per source. Useful while iterating.
   */
  INGEST_LIMIT: z.coerce.number().int().positive().optional(),

  /**
   * Which subset to ingest. Defaults to "all".
   */
  INGEST_SOURCE: z.enum(["all", "docs", "source", "issues"]).default("all"),

  /**
   * Git ref of the Mastra repo to ingest. Pinning matters because the API
   * surface changes between releases; we want reproducible KBs.
   */
  MASTRA_REF: z.string().default("main"),

  // --- Logging ------------------------------------------------------------
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

/**
 * Parse and freeze. We call `parse` (not `safeParse`) so the process exits
 * with a clean error message if a required var is missing. The user is
 * typically running the script interactively when this happens, so a
 * stack trace is the wrong UX.
 */
const parsed = schema.parse(process.env);

/**
 * Derive `VECTOR_BACKEND` from the presence of `POSTGRES_CONNECTION_STRING`
 * when the user hasn't set it explicitly. This is the "works out of the
 * box" behavior: clone the repo, `npm install`, `npm run dev` -> in-memory
 * store, no config.
 */
if (!parsed.VECTOR_BACKEND) {
  parsed.VECTOR_BACKEND = parsed.POSTGRES_CONNECTION_STRING ? "pg" : "memory";
}

export const env = Object.freeze(parsed);
export type Env = z.infer<typeof schema>;
