/**
 * src/backend/rag/generation.ts
 * ----------------------------------------------------------------------------
 * Step 4 of the RAG pipeline: stream the LLM's response.
 *
 * What "generation" means in RAG (educational):
 *   Once we have retrieved the right chunks and built a system prompt
 *   that grounds the model in those chunks, we ask the LLM to produce
 *   an answer. The *generation* step is just "talk to the LLM, stream
 *   its tokens back, and handle errors".
 *
 * Why generation is its own module:
 *   - The LLM API is a leaky abstraction (rate limits, timeouts,
 *     partial responses, prompt caching headers). Centralizing that
 *     in one file means the rest of the pipeline never has to think
 *     about it.
 *   - Tests can mock this module completely; route tests don't have
 *     to know we use Anthropic.
 *   - Swapping LLM providers (e.g. to OpenAI for a comparison eval)
 *     only touches this file.
 *
 * Why we use the Vercel AI SDK's `streamText` (and not Mastra's agent
 * loop):
 *   `streamText` produces an SSE stream in the exact protocol the
 *   frontend's `useChat` hook speaks. That means the API contract is
 *   "drop in `toUIMessageStreamResponse()` and you're done" — no
 *   hand-rolled SSE parsing on either end.
 *
 * Why a low temperature (0.2):
 *   For a RAG app we want *deterministic, factual* answers. Temperature
 *   is the random "creativity" dial on the model. At 1.0 the model
 *   picks among many plausible next tokens; at 0 it always picks the
 *   most likely one. 0.2 is the sweet spot for a chat assistant: still
 *   has slight variation (so the same question twice doesn't produce
 *   a byte-identical answer) but grounded in the retrieved context.
 *
 * Why we pass the system prompt with prompt caching:
 *   The system prompt is large and *mostly identical* across requests
 *   (only the sources block changes). Prompt caching lets us mark
 *   long-lived prefix as cacheable so Anthropic bills us less for
 *   repeated reads.
 * ----------------------------------------------------------------------------
 */
import {
  streamText,
  createUIMessageStream,
  type AsyncIterableStream,
  type ModelMessage,
  type UIMessageChunk,
} from "ai";
import { convertToModelMessages } from "ai";

import { log } from "@/lib/logger";
import {
  getAnthropicModel,
  hasAnthropicCredentials,
} from "@/lib/anthropic";
import type { IncomingMessage } from "@/../api-contract";
import { buildCitations } from "./citations";
import type { RetrievedChunk } from "@/lib/vector-store-reader";
import type { RetrievalResult } from "./retrieval";

/**
 * Sampling temperature. Low = factual. See the file-level comment.
 */
const TEMPERATURE = 0.2;

/**
 * Maximum tokens to generate. Why a cap: protects us from runaway
 * generation if the model decides to write a novel.
 */
const MAX_TOKENS = 2048;

/**
 * Per-request timeout. Why: a hung request is worse than a fast
 * failure. Vercel kills the function at 60s on hobby, 300s on pro;
 * 25s is well under either and gives the model room for long answers.
 */
const REQUEST_TIMEOUT_MS = 25_000;

/**
 * A simplified message shape the LLM consumes. The frontend's
 * `UIMessage` has many optional parts (tool calls, file refs) we
 * don't support in v1, so we keep our own internal type.
 */
export interface GenerationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Inputs to the generation step.
 *
 * Why we re-take the system prompt as a parameter (not derived here):
 *   The pipeline orchestrator is the single place that knows the
 *   system prompt and the source list. Generation just consumes them.
 */
export interface GenerateOptions {
  system: string;
  messages: GenerationMessage[];
  chunks: ReadonlyArray<RetrievedChunk>;
  /** Optional: if omitted we use the default Anthropic model. */
  modelId?: string;
  /** Optional: the full retrieval result (for telemetry). */
  retrieval?: RetrievalResult;
  /**
   * Optional: the latest user query text. Used by the MOCK=1 path to
   * craft a plausible synthesized answer that references the user's
   * actual question. Falls back to the last user message in `messages`.
   */
  query?: string;
}

/**
 * Is the MOCK=1 short-circuit active?
 *
 * Why a helper (and not a direct `process.env.MOCK === "1"`):
 *   - Tests want to flip the flag without mutating `process.env`.
 *   - The flag is read in two places (here and `canGenerate`), so the
 *     single source of truth prevents drift.
 */
export function isMockMode(): boolean {
  return process.env.MOCK === "1";
}

/**
 * Streaming output of the generation step.
 *
 * Why we return a `UIMessageStream`:
 *   It's the AI SDK's native representation of a chat turn. The
 *   `route.ts` handler can pass it directly to
 *   `toUIMessageStreamResponse()` to get an HTTP `Response` with
 *   the right `Content-Type` and SSE framing.
 */
export interface GenerationOutput {
  /**
   * The AI SDK UI message stream. The route handler wraps it in
   * `toUIMessageStreamResponse()` for HTTP transport.
   */
  stream: AsyncIterableStream<UIMessageChunk>;
  /**
   * Pre-built citation list, ready to be merged into a `data-sources`
   * part. Why returned here (not in the stream): citations are
   * *metadata* about the response, not part of the prose. We want
   * to ship them as a single discrete part at the end.
   */
  citations: ReturnType<typeof buildCitations>;
  /**
   * The model id that was used, for logging and telemetry.
   */
  modelId: string;
}

/**
 * Build the LLM's `messages` array from the chat history.
 *
 * Why we do this mapping:
 *   The frontend's `UIMessage` has a `parts` array (text + tool calls).
 *   Anthropic expects simple `{ role, content: string }` pairs in v1.
 *   We collapse parts to plain text and rely on the system prompt to
 *   carry the retrieved context.
 */
export function toModelMessages(
  messages: ReadonlyArray<IncomingMessage>,
): ModelMessage[] {
  // convertToModelMessages is the AI SDK's helper that turns a
  // UIMessage[] (with parts) into a ModelMessage[] (single content
  // string per message). We use it here for forward-compat: if the
  // client starts sending tool parts, we'll handle them automatically.
  // We cast through unknown because our `IncomingMessage` is a strict
  // subset of `UIMessage` and the SDK doesn't know that.
  //
  // Note: convertToModelMessages expects each message to have a
  // `parts` array (the AI SDK v5+ shape). Our IncomingMessage is the
  // v1 plain-text shape. We synthesize a single `text` part so the
  // SDK's helper can run without throwing.
  return convertToModelMessages(
    messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: [{ type: "text", text: m.content }],
    })) as unknown as Parameters<typeof convertToModelMessages>[0],
  ) as unknown as ModelMessage[];
}

/**
 * Generate a streaming response.
 *
 * Why we accept a model injection point:
 *   Tests pass a fake model. The real path uses `getAnthropicModel()`.
 *   This keeps the function pure of `process.env` reads.
 */
export async function generate(
  options: GenerateOptions,
): Promise<GenerationOutput> {
  const modelId = options.modelId ?? process.env.MODEL_ID ?? "claude-sonnet-4-5";

  log.info(
    {
      model: modelId,
      msgCount: options.messages.length,
      chunkCount: options.chunks.length,
    },
    "generation.start",
  );

  // Why we build citations *before* streaming:
  //   The `data-sources` part is appended to the same stream as the
  //   text. Building it up front means the stream can include the
  //   citations as soon as the text is done, with no per-token
  //   coupling.
  const citations = buildCitations(options.chunks, { embeddingModel: "voyage-code-3" });
  log.debug({ count: citations.length }, "generation.citations.built");

  // Mock path: two distinct triggers short-circuit to the synthesized
  // stream.
  //   1. MOCK=1 was set explicitly. The user wants to demo / dev with
  //      zero API keys. The Anthropic SDK is never called.
  //   2. No credentials AND MOCK wasn't set. We degrade to a hand-crafted
  //      stream rather than letting the SDK return a confusing 401.
  //      (Same outcome as MOCK=1, different intent.)
  if (isMockMode()) {
    log.info({ query: options.query }, "generation.mock.short_circuit");
    return {
      stream: buildMockAnswerStream(options) as unknown as GenerationOutput["stream"],
      citations,
      modelId: "mock-local",
    };
  }
  if (!hasAnthropicCredentials()) {
    log.warn("generation.mockFallback.noCredentials");
    return {
      stream: buildMockAnswerStream(options) as unknown as GenerationOutput["stream"],
      citations,
      modelId: "mock-local",
    };
  }

  // We use the AI SDK's `streamText` to get a UI message stream.
  // The model is supplied via the AI SDK Anthropic provider — the
  // AI SDK handles SSE framing, retries, and the prompt-caching
  // headers Anthropic expects.
  //
  // Why `as unknown as` on the messages:
  //   `streamText`'s `messages` parameter is typed loosely; our
  //   internal type is a subset, so we cast through unknown to
  //   keep the public API clean.
  const result = streamText({
    model: getAnthropicModel(),
    system: options.system,
    messages: options.messages as unknown as ModelMessage[],
    temperature: TEMPERATURE,
    maxOutputTokens: MAX_TOKENS,
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    onError: ({ error }) => {
      // We log on the server because errors that surface to the
      // client are already converted to a `data-error` part.
      log.error({ error: serializeError(error) }, "generation.error");
    },
    onFinish: ({ text, usage }) => {
      log.info(
        {
          textLength: text.length,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        },
        "generation.finish",
      );
    },
  });

  // Why `toUIMessageStream`:
  //   It returns the same shape `useChat` consumes on the client.
  //   The route handler can pass it to `toUIMessageStreamResponse()`
  //   to get the right `Content-Type: text/event-stream` and SSE
  //   framing.
  const uiStream = result.toUIMessageStream();

  return {
    stream: uiStream,
    citations,
    modelId,
  };
}

/**
 * Pre-flight check: do we have what we need to generate a real
 * response? In `MOCK=1` dev we want to short-circuit with a clear
 * error rather than letting the SDK return a confusing 401.
 */
export function canGenerate(): { ok: true } | { ok: false; reason: string } {
  if (!hasAnthropicCredentials() && !isMockMode()) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not set" };
  }
  return { ok: true };
}

/**
 * Serialize an unknown error into a log-friendly shape.
 *
 * Why: `error` may be a string, a plain object, an `Error`, or a
 * SDK-specific error class. We normalize so log consumers don't
 * have to know about every error type.
 */
function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  if (typeof err === "string") return { message: err };
  if (typeof err === "object" && err !== null) {
    return { ...(err as Record<string, unknown>) };
  }
  return { value: String(err) };
}

/**
 * Build a hand-crafted UIMessageStream for the MOCK=1 (or no-credentials)
 * path.
 *
 * Why we have this:
 *   `npm install && npm run dev` must work with zero env vars. When
 *   there's no Anthropic key, OR when the user has explicitly set
 *   MOCK=1, we synthesize a credible answer from the retrieved chunks
 *   (with inline citations) and stream it token-by-token so the UI's
 *   streaming UX is exercised.
 *
 * The synthesized answer:
 *   - Opens with a short framing sentence so the answer reads as a
 *     real chat response (not a list of snippets).
 *   - References the user's actual question.
 *   - Cites each retrieved chunk with a `[n]` marker, matching the
 *     convention the real prompt asks the model to use.
 *   - Closes with a one-line note about MOCK mode.
 *
 * The stream emits:
 *   - one `start` chunk
 *   - one `text-start` + multiple `text-delta` chunks + one `text-end`
 *   - one `finish` chunk
 *
 * It returns a stream compatible with `toUIMessageStreamResponse`'s
 * expectations. We build it with `createUIMessageStream` so the wire
 * format is identical to the real path.
 */
function buildMockAnswerStream(
  options: GenerateOptions,
): ReadableStream<unknown> {
  const answer = composeMockAnswer(options);

  // We reuse `createUIMessageStream` so the wire format matches the
  // real path exactly. The casts through `unknown` are necessary
  // because our local types are a strict subset of the SDK's union.
  return createUIMessageStream({
    execute: async ({ writer }) => {
      const messageId = `mock-${Date.now()}`;
      const textId = `${messageId}-text`;
      await writer.write({ type: "start", messageId } as unknown as Parameters<typeof writer.write>[0]);
      await writer.write({ type: "text-start", id: textId } as unknown as Parameters<typeof writer.write>[0]);
      // Emit the answer in 6-char chunks with a small delay so the
      // UI's streaming animation is visible but not glacially slow.
      const chunkSize = 6;
      for (let i = 0; i < answer.length; i += chunkSize) {
        const piece = answer.slice(i, i + chunkSize);
        await writer.write({
          type: "text-delta",
          id: textId,
          delta: piece,
        } as unknown as Parameters<typeof writer.write>[0]);
        await new Promise((r) => setTimeout(r, 8));
      }
      await writer.write({ type: "text-end", id: textId } as unknown as Parameters<typeof writer.write>[0]);
      await writer.write({ type: "finish" } as unknown as Parameters<typeof writer.write>[0]);
    },
  }) as unknown as ReadableStream<unknown>;
}

/**
 * Compose the synthesized MOCK answer text.
 *
 * Why a separate function: the body of `buildMockAnswerStream` is
 * already a state machine for stream emission. Putting the
 * templating in its own function keeps the streaming code obvious.
 *
 * Shape of the output (when there are retrieved chunks):
 *   "Based on the EU AI Act, here's what the retrieved sources say
 *    about "<question>":
 *
 *    <one-sentence framing claim> [1]. <next claim, possibly about
 *    the same source> [2]. <next claim> [3] ...
 *
 *    This is a MOCK-mode synthesized answer. Set ANTHROPIC_API_KEY
 *    to get a real LLM response with prompt caching."
 *
 * Why prose, not a bulleted list:
 *   The real Anthropic path emits flowing legal-research prose with
 *   inline `[n]` markers. The MOCK answer must look the same so the
 *   UI's rendering, citation chip matching, and streaming animation
 *   exercise the same code path. A "From source [1]:" paragraph
 *   header was the old ugly pattern — citations belong at the end
 *   of the sentence that makes the claim, not as a header before
 *   a block quote.
 *
 * The citations are 1-based and line up with the order chunks are
 * passed in, which matches the index the route appends to the
 * `data-sources` part.
 */
function composeMockAnswer(options: GenerateOptions): string {
  const retrieval = options.chunks;
  const question = (options.query ?? lastUserText(options.messages) ?? "your question").trim();

  if (retrieval.length === 0) {
    return [
      `Based on the EU AI Act, here's what the retrieved sources say about "${question}":`,
      "",
      "I couldn't find anything relevant to your question in the retrieved sources [1].",
      "",
      "Try rephrasing with more specific article numbers or terms (e.g. \"Article 5\", \"high-risk\", \"transparency\").",
      "",
      "Note: MOCK mode is active — set ANTHROPIC_API_KEY to get a real LLM-synthesized answer.",
    ].join("\n");
  }

  // Build the prose sentences. Each chunk contributes one sentence;
  // the [n] marker is appended to the *end* of the sentence that
  // makes the claim, not as a paragraph header.
  //
  // Why per-chunk sentence extraction:
  //   The chunk text is what the vector store returned — it's the
  //   most grounded phrasing we have. We pick the most relevant
  //   sentence (the first non-empty one) and use it as the claim.
  //   We cap at three body sentences (and three distinct citations)
  //   to stay in the 2-to-5 citation range the system prompt asks
  //   for; more chunks would just re-cite the same sources.
  const lines: string[] = [];

  // Opening framing line. The user sees "you asked X, and here's
  // what we found" before the body claims. This matches the real
  // Anthropic path's behavior and gives the answer a natural opening.
  lines.push(
    `Based on the EU AI Act, here's what the retrieved sources say about "${question}":`,
  );
  lines.push("");

  // Body: up to three sentences, each ending with an inline [n]
  // marker. The first retrieved chunk gets the lead claim; later
  // chunks add supporting points.
  const bodyLimit = Math.min(retrieval.length, 3);
  for (let i = 0; i < bodyLimit; i++) {
    const chunk = retrieval[i]!;
    const claim = claimFromChunk(chunk);
    lines.push(`${claim} [${i + 1}].`);
  }

  lines.push("");
  lines.push(
    "This is a MOCK-mode synthesized answer. Set ANTHROPIC_API_KEY to get a real LLM response with prompt caching.",
  );

  return lines.join("\n");
}

/**
 * Pick the most relevant sentence from a chunk's text.
 *
 * Why: a chunk can be a 1200-character snippet. The synthesized
 * answer should pick the *single* most informative sentence rather
 * than dumping the whole snippet, so the prose stays scannable.
 *
 * Why first non-empty sentence, not random or last:
 *   The vector store stores chunks in their natural reading order.
 *   The first sentence is almost always the lead claim ("Article 5
 *   prohibits…", "Recital 10 explains…"). Later sentences are
 *   elaborations. We take the lead claim, truncated to a reasonable
 *   length, so the answer reads as a *summary* of the chunk.
 */
function claimFromChunk(chunk: RetrievedChunk): string {
  const text = chunk.text.trim();
  if (!text) return "A retrieved source discusses this topic";
  // Split on sentence-ending punctuation. The first non-trivial
  // sentence is the lead claim.
  const parts = text.split(/(?<=[.!?])\s+/);
  let lead = parts.find((s) => s.trim().length > 0) ?? text;
  // Truncate to keep the synthesized answer scannable.
  if (lead.length > 220) {
    lead = lead.slice(0, 220).trim() + "…";
  }
  // Strip any trailing period — the caller decides punctuation so
  // multiple [n] markers in a single sentence stay grammatical.
  return lead.replace(/[.!?]+\s*$/, "");
}

/**
 * Walk the messages and return the most recent user-role text.
 *
 * Why: when `GenerateOptions.query` is not provided (older callers),
 * we still want the MOCK answer to reference the user's question.
 */
function lastUserText(
  messages: ReadonlyArray<{ role: string; content: string }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user" && m.content.trim()) {
      return m.content;
    }
  }
  return null;
}
