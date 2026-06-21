/**
 * src/backend/rag/pipeline.ts
 * ----------------------------------------------------------------------------
 * The RAG orchestrator. Wires retrieval + prompt + generation into a
 * single `runRagPipeline()` call so the API route doesn't have to
 * know the order of steps.
 *
 * Why an orchestrator (educational):
 *   A RAG pipeline is a small *data flow*: query in, retrieved chunks,
 *   then a prompt, then a stream out. Each step has its own concerns
 *   (embed math, prompt engineering, LLM I/O). Without an orchestrator
 *   the route handler ends up importing all three modules and threading
 *   their outputs manually — which couples it to the internal shape
 *   of every step.
 *
 *   This file owns the *seams*: the call signatures, the logging,
 *   the error model. Steps can change shape internally without
 *   affecting anything outside this file.
 *
 * Why this returns a `UIMessageStream` (not a `Response`):
 *   - The route handler is the only place that knows about HTTP. The
 *     pipeline should be HTTP-agnostic so it can be reused in scripts
 *     (e.g. the eval runner).
 *   - The AI SDK's `toUIMessageStreamResponse()` is a one-liner when
 *     we want the HTTP shape; doing it here would force every caller
 *     to deal with `Request`/`Response` types.
 *
 * Why we error-fast on retrieval-empty but warn-only on low-score:
 *   - Empty retrieval means there's *literally nothing* in the corpus
 *     that could answer the user. We have to short-circuit and tell
 *     the user, otherwise the LLM will hallucinate.
 *   - Low-score retrieval is still *some* signal. We let the LLM try
 *     and trust the system prompt to make it refuse if it can't
 *     produce a grounded answer. Logging at warn keeps the signal
 *     visible for evals.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";
import { createUIMessageStream } from "ai";
import { retrieve, type RetrievalResult } from "./retrieval";
import { buildPrompt, type BuiltPrompt } from "./prompt";
import { generate, type GenerationOutput } from "./generation";
import type { RetrievedChunk } from "@/lib/vector-store-reader";
import type { IncomingMessage, Source, Citation } from "@/../api-contract";
import { buildCitations } from "./citations";

/**
 * The minimum confidence below which we consider retrieval "empty
 * enough" to short-circuit. 0.5 = "best chunk is at most vaguely
 * related".
 *
 * Why a number (vs. a function):
 *   The threshold is a single, configurable policy. A function would
 *   obscure it; a constant is grep-able.
 */
const EMPTY_RETRIEVAL_THRESHOLD = 0.5;

/**
 * The minimum top-score needed in local (no-API-key) mode to consider
 * retrieval "good enough" to actually call the LLM. We lower the
 * threshold because the local hash-based embedder produces near-zero
 * cosine similarities — even a perfect match is around 0.3. 0.05 is
 * "the local embedder found something that shares at least one token".
 */
const LOCAL_EMPTY_RETRIEVAL_THRESHOLD = 0.05;

/**
 * Detect the local-embedder mode. We read the same flag the embedder
 * does so the two stay in sync.
 */
function isLocalEmbedderMode(): boolean {
  return !process.env.VOYAGE_API_KEY && !process.env.OPENAI_API_KEY;
}

/**
 * Public inputs to the pipeline.
 */
export interface RunPipelineInput {
  query: string;
  messages: ReadonlyArray<IncomingMessage>;
  /** Optional overrides for tests. */
  options?: {
    topK?: number;
    minScore?: number;
    modelId?: string;
  };
}

/**
 * The output of the pipeline. Mirrors `GenerationOutput` but adds the
 * `retrieval` block (useful for the UI's "show debug info" toggle)
 * and a pre-built `citations` array.
 */
export interface PipelineOutput {
  stream: GenerationOutput["stream"];
  retrieval: RetrievalResult;
  citations: ReadonlyArray<Citation>;
  sources: ReadonlyArray<Source>;
  prompt: BuiltPrompt;
  modelId: string;
}

/**
 * Run the full RAG pipeline.
 *
 * Why this is a single function:
 *   The route handler should be able to do:
 *     const out = await runRagPipeline(input);
 *     return toUIMessageStreamResponse({ stream: out.stream, ... });
 *   Anything more complicated is a smell that we should split a step.
 */
export async function runRagPipeline(
  input: RunPipelineInput,
): Promise<PipelineOutput> {
  const startedAt = Date.now();
  const { query, messages, options } = input;

  log.info(
    { queryLength: query.length, msgCount: messages.length },
    "pipeline.start",
  );

  // --- Step 1: Retrieve ---
  //
  // In local-embedder mode the cosine similarities are near-zero
  // (the hash embedder produces orthogonal-ish vectors), so the
  // retrieval layer's 0.5 min-score filter would drop everything.
  // We override the min-score to 0 to let the local KB contribute
  // anything that has at least one shared token.
  const localMode = isLocalEmbedderMode();
  const retrieval = await retrieve(query, {
    topK: options?.topK,
    minScore: options?.minScore ?? (localMode ? 0 : undefined),
  });

  // --- Step 2: Handle the empty-retrieval case explicitly ---
  //
  // Why short-circuit:
  //   If the vector store returned nothing, the LLM has no grounded
  //   evidence to draw from. Letting it try anyway is the most common
  //   RAG failure mode: the model will invent a plausible-sounding
  //   answer. The system prompt's refusal rule covers this, but we'd
  //   rather not even *call* the LLM — saves tokens, latency, and the
  //   cost of a 4xx from the LLM.
  //
  // Borderline non-empty (chunks present but top score below the empty
  // threshold) is treated as "proceed". The retrieval layer's broad
  // fallback already widened the score floor when the strict pass
  // returned zero; here the strict pass already returned a non-empty
  // result, so the broad path didn't run. Either way, the prompt's
  // "cite only the sources block" rule disciplines whatever the model
  // produces — the worst case is a low-confidence answer, not a refusal.
  const trulyEmpty = retrieval.chunks.length === 0;
  const borderlineNonEmpty =
    !trulyEmpty &&
    retrieval.metadata.topScore <
      (localMode ? LOCAL_EMPTY_RETRIEVAL_THRESHOLD : EMPTY_RETRIEVAL_THRESHOLD);

  if (trulyEmpty) {
    log.warn(
      {
        chunkCount: retrieval.chunks.length,
        topScore: retrieval.metadata.topScore,
      },
      "pipeline.empty_retrieval",
    );

    return buildRefusalStream({
      retrieval,
    });
  }

  if (borderlineNonEmpty) {
    log.info(
      {
        chunkCount: retrieval.chunks.length,
        topScore: retrieval.metadata.topScore,
        usedBroadFallback: retrieval.metadata.usedBroadFallback,
      },
      "pipeline.borderline_proceed",
    );
  }


  // --- Step 3: Build the prompt ---
  //
  // We use the *latest* user message as the question, with the prior
  // turns collapsed into a recap. The system prompt carries the rules
  // + sources block.
  const latestUserText = extractLatestUserText(messages) ?? query;
  const priorTurns = extractPriorTurns(messages);
  const prompt = buildPrompt(retrieval.chunks, latestUserText, priorTurns);

  // --- Step 4: Generate ---
  const generation = await generate({
    system: prompt.system,
    messages: messages.map((m) => ({ role: m.role, content: messageText(m) })),
    chunks: retrieval.chunks,
    // The query is what the MOCK-mode synthesizer references in its
    // opening sentence. The real Anthropic path doesn't need it
    // (it already sees the messages), but passing it through keeps
    // both paths aligned.
    query: latestUserText ?? query,
    ...(options?.modelId ? { modelId: options.modelId } : {}),
    retrieval,
  });

  const citations = buildCitations(retrieval.chunks, {
    embeddingModel: retrieval.metadata.embeddingModel,
  });

  log.info(
    {
      latencyMs: Date.now() - startedAt,
      chunkCount: retrieval.chunks.length,
      citationCount: citations.length,
    },
    "pipeline.end",
  );

  return {
    stream: generation.stream,
    retrieval,
    citations,
    sources: citations.map((c) => c.source),
    prompt,
    modelId: generation.modelId,
  };
}

/**
 * Pull the most recent user message out of the chat history.
 *
 * Why: the prompt builder wants a "latest question" string for the
 * recap. We don't want to scan the messages array on every prompt
 * build.
 *
 * Why we read from `parts` (with a `content` fallback):
 *   `IncomingMessage` is the AI SDK v6 `{ id, role, parts }` shape;
 *   the route normalizes messages so `parts` is always present, but
 *   legacy v1 callers may have left a `content` field set as well.
 *   We collapse both into a single string for the prompt builder.
 */
function extractLatestUserText(
  messages: ReadonlyArray<IncomingMessage>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    const text = messageText(m);
    if (text.trim()) return text;
  }
  return null;
}

/**
 * Build the recap array: every turn except the latest user message.
 *
 * Why exclude the latest:
 *   The latest user text is rendered separately as the "actual"
 *   question. The recap shows context, not the question being
 *   answered right now.
 */
function extractPriorTurns(
  messages: ReadonlyArray<IncomingMessage>,
): ReadonlyArray<{ role: "user" | "assistant"; text: string }> {
  // Find the last user message index; everything before it is "prior".
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  return messages
    .slice(0, lastUserIdx)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", text: messageText(m) }));
}

/**
 * Collapse an `IncomingMessage`'s `parts` (or `content`) to a single
 * plain-text string. The route normalizes so `parts` is always
 * present; we keep `content` as a defensive fallback.
 */
function messageText(m: IncomingMessage): string {
  if (Array.isArray(m.parts) && m.parts.length > 0) {
    return m.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
  }
  return m.content ?? "";
}

/**
 * Build a "refusal" stream for the case where retrieval returned
 * nothing. The stream contains a single text part with the refusal
 * message; no `data-sources` part is emitted (there's nothing to cite).
 *
 * Why a separate function:
 *   The refusal path is the only place we *don't* want to call the
 *   LLM. Centralizing the synthetic stream construction here means
 *   the route handler doesn't have to special-case it.
 */
function buildRefusalStream(params: { retrieval: RetrievalResult }): PipelineOutput {
  const refusalText =
    "I couldn't find anything on that in the EU AI Act sources I have. Could you rephrase the question, or mention the article or topic by name?";
  // We synthesize a `UIMessageStream` from a single text-delta chunk.
  // The AI SDK's text streaming protocol uses `text-start`, `text-delta`,
  // and `text-end` events. We emit a delta directly; the SDK will
  // wrap it appropriately when consumed.
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // Cast: the SDK's writer.write type is a discriminated union
      // that doesn't include the bare `{ type: "text" }` shorthand.
      // Using the streaming chunk type keeps us forward-compatible.
      await writer.write({
        type: "text-delta",
        id: "refusal",
        delta: refusalText,
      } as unknown as Parameters<typeof writer.write>[0]);
    },
  });

  return {
    // Cast: the SDK's `createUIMessageStream` returns a
    // `ReadableStream`, while our pipeline type uses
    // `AsyncIterableStream` (the actual ergonomic shape). They are
    // structurally identical at runtime; we cast through unknown to
    // bypass a TypeScript-only mismatch in the SDK's .d.ts file.
    stream: stream as unknown as PipelineOutput["stream"],
    retrieval: params.retrieval,
    citations: [],
    sources: [],
    prompt: { system: "(empty retrieval — refusal)", userMessage: refusalText },
    modelId: "refusal",
  };
}

/**
 * Expose the citation/metadata-building helpers so the route handler
 * can call them without re-importing from `./citations` directly.
 */
export { buildCitations } from "./citations";
export type { RetrievedChunk };
