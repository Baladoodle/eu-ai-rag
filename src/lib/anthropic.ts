/**
 * src/lib/anthropic.ts
 * ----------------------------------------------------------------------------
 * Thin wrapper around the Anthropic SDK + the Vercel AI SDK's Anthropic
 * provider. We expose two entry points:
 *
 *   1. `getAnthropicModel()`  — returns a `LanguageModel` from the AI SDK,
 *      which is what `streamText` consumes. This is the path used by the
 *      chat route because it gives us first-class streaming, tool use, and
 *      UI message stream compatibility.
 *
 *   2. `getAnthropicClient()`  — returns the raw Anthropic SDK client. This
 *      is what `streamAnthropicMessages()` uses when we want direct
 *      control over `messages.stream()` and prompt caching headers.
 *
 * Why two entry points:
 *   The AI SDK's `streamText` is the right adapter for the SSE wire
 *   protocol the frontend speaks, but the raw Anthropic SDK lets us
 *   attach Anthropic-specific features (notably prompt caching) that
 *   the AI SDK provider wrapper doesn't yet expose. Generation lives in
 *   `src/backend/rag/generation.ts` and picks the appropriate one.
 *
 * Why we centralize here:
 *   - The API key, base URL, and model id are all configured in one place.
 *   - Tests can `vi.mock` this module and get a fake model/client.
 *   - Swapping providers (e.g. to Bedrock) means editing one file.
 * ----------------------------------------------------------------------------
 */
import { anthropic as createAnthropic } from "@ai-sdk/anthropic";
import Anthropic from "@anthropic-ai/sdk";
import type { LanguageModel } from "ai";

import { log } from "@/lib/logger";

/**
 * The default Claude model. We pick Sonnet because it's the strongest
 * mid-tier model for code reasoning and structured instruction following
 * at a price that's reasonable for a chat workload.
 *
 * Why we read from env: lets a developer A/B test against Opus or Haiku
 * without redeploying code.
 */
const DEFAULT_MODEL = "claude-sonnet-4-5";

/**
 * Read the model id from the environment, falling back to the default.
 *
 * Why: keeps deployment-specific config out of the source while still
 * giving ops a single env var to flip.
 */
export function getModelId(): string {
  return process.env.MODEL_ID ?? DEFAULT_MODEL;
}

/**
 * Read the Anthropic API key from the environment.
 *
 * Why a helper: in dev with `MOCK=1` the key is intentionally missing —
 * MSW intercepts the request before it ever reaches Anthropic. Centralizing
 * the read means we only have one place to test the "missing key" path.
 */
export function getApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY;
}

/**
 * Get an AI SDK `LanguageModel` instance pointing at Anthropic.
 *
 * Why the AI SDK provider instead of the raw client for `streamText`:
 *   - It implements the `LanguageModelV2` interface the AI SDK's
 *     `streamText` expects, so we get SSE framing, abort signals, and
 *     retries for free.
 *   - It plays nicely with `convertToModelMessages`, which converts the
 *     frontend's UIMessages into the shape the LLM expects.
 *
 * The returned model is *not* stateful — calling this multiple times
 * returns equivalent (but not identical) instances. Cache the result
 * if you need identity stability.
 */
export function getAnthropicModel(): LanguageModel {
  const model = createAnthropic(getModelId());
  log.debug({ model: getModelId() }, "anthropic.model.ready");
  return model;
}

/**
 * Get a raw Anthropic SDK client.
 *
 * Why we sometimes want the raw client:
 *   - Prompt caching: the AI SDK provider doesn't yet support Anthropic's
 *     `cache_control` blocks on system prompts. To get the ~5x cost
 *     reduction on cached tokens we have to call `messages.stream()`
 *     ourselves.
 *   - Direct SSE event inspection: useful for fine-grained logging or
 *     for surfacing tool-use events to the client.
 */
export function getAnthropicClient(): Anthropic {
  const apiKey = getApiKey();
  return new Anthropic({
    apiKey: apiKey ?? "missing-key-mock",
    // We don't set `dangerouslyAllowBrowser` — this client is server-only.
  });
}

/**
 * Check whether we have the credentials to talk to the real Anthropic API.
 *
 * Why a separate predicate: route handlers and tests want to short-circuit
 * with a friendly error before constructing a model that would fail at
 * first request. Mocked tests can pretend to have a key without one.
 */
export function hasAnthropicCredentials(): boolean {
  return Boolean(getApiKey());
}
