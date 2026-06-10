/**
 * api-contract.ts
 * ----------------------------------------------------------------------------
 * Single source of truth for the shape of every payload that crosses the
 * network boundary in mastra-expert.
 *
 * Why this file exists (educational note):
 *   In a RAG app, three boundaries are easy to break with silent type drift:
 *     1. The HTTP request coming from the browser.
 *     2. The SSE stream sent back to the browser.
 *     3. The shape of "a citation" as understood by the UI.
 *   Centralizing them here means the route handler, the React components,
 *   the tests, and the eval fixtures all reference the same types. If you
 *   change a field here, TypeScript will flag every consumer.
 *
 * Conventions:
 *   - All optional fields use `?`, never `undefined | T`.
 *   - All timestamps are ISO 8601 strings (UTC). We never serialize Date.
 *   - Branded IDs prevent accidentally passing a `SourceId` where a
 *     `SessionId` is expected.
 * ----------------------------------------------------------------------------
 */

// ---------- Branded ID types ------------------------------------------------

/**
 * A branded string type. The brand is a phantom property that exists only at
 * compile time, so two `string` values can never be assignable to each other
 * even though they share the same runtime representation.
 *
 * Why: we want `sessionId` and `sourceId` to both be strings, but a typo
 *      like `getSource(sessionId)` should fail at compile time, not at
 *      runtime as a confusing "source not found".
 */
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type SessionId = Brand<string, "SessionId">;
export type SourceId = Brand<string, "SourceId">;
export type MessageId = Brand<string, "MessageId">;

export const asSessionId = (s: string): SessionId => s as SessionId;
export const asSourceId = (s: string): SourceId => s as SourceId;
export const asMessageId = (s: string): MessageId => s as MessageId;

// ---------- Citation & Source ----------------------------------------------

/**
 * One retrievable piece of knowledge from the corpus.
 *
 * The `id` is stable across re-ingestion and is what the UI uses to deep-link
 * a `[1]` chip in the assistant text to a card in the source list.
 */
export interface Source {
  /** Stable identifier, e.g. "mastra-docs/rag/overview#chunk-3". */
  id: SourceId;

  /** Human-readable title shown in the source panel. */
  title: string;

  /** Canonical URL — what we open in a new tab when the user clicks. */
  url: string;

  /** Optional H2/H3 heading within the source, when extractable. */
  section?: string;

  /**
   * The retrieved text. Truncated to ~300 chars for display, but the full
   * text is sent over the wire so the UI can show "show more" without a
   * second fetch. (Trade-off: slightly larger SSE payload.)
   */
  snippet: string;

  /**
   * The full chunk text, identical to what the retriever saw. The UI may
   * collapse `snippet` and only show `fullText` on user request.
   */
  fullText: string;

  /**
   * Cosine similarity between the query embedding and this chunk, 0..1.
   * We rescale from raw pgvector distance (1 - distance) so consumers
   * never have to think about distance vs similarity.
   */
  score: number;

  /** When this chunk was retrieved (ISO 8601 UTC). */
  retrievedAt: string;
}

/**
 * A citation as it appears in the streamed text. We emit one Citation
 * per source — the UI renders them as `[1]`, `[2]`, etc. and uses the
 * `index` field to look up the corresponding Source.
 */
export interface Citation {
  /** 1-based index, matches the `[n]` marker in the assistant text. */
  index: number;

  /** The source being cited. */
  source: Source;
}

// ---------- Messages --------------------------------------------------------

/**
 * The minimum message shape we accept from the client. We intentionally
 * re-declare this instead of importing @ai-sdk/react's UIMessage so the
 * server doesn't have to trust the client's full discriminated union.
 *
 * On the server we will pass these to the AI SDK's convertToModelMessages.
 */
export interface IncomingMessage {
  id: MessageId;
  role: "user" | "assistant" | "system";
  /** Plain text only in v1 — no tool parts, no file parts. */
  content: string;
}

// ---------- Request / Response --------------------------------------------

/**
 * Body of `POST /api/chat`. Validated by Zod at the route boundary.
 *
 * Why a `sessionId`: we don't yet have long-term memory, but we do want
 * logs to be correlatable. A client-generated UUID is good enough.
 */
export interface ChatRequest {
  messages: IncomingMessage[];
  sessionId?: SessionId;
}

/**
 * Custom part types we emit in the UI message stream, on top of the AI SDK's
 * standard `text` and `reasoning` parts.
 *
 * The `data-` prefix follows the AI SDK v6 custom-data-part convention: any
 * part whose type starts with `data-` is treated as opaque data by the SDK
 * and surfaced to the client as-is.
 */
export type CustomUIPart =
  | {
      type: "data-sources";
      data: {
        citations: Citation[];
        /** Retrieval metrics, useful for the UI's "debug" toggle. */
        retrieval: RetrievalMetadata;
      };
    }
  | {
      type: "data-error";
      data: {
        /** Machine-readable code, e.g. "RETRIEVAL_EMPTY" | "LLM_5XX". */
        code: ChatErrorCode;
        /** Human-readable, safe to show to the user. */
        message: string;
      };
    };

/**
 * Metadata about the retrieval step. Emitted once at the end of the stream.
 * The UI may show a "Retrieved 5 sources in 142ms" hint when this part arrives.
 */
export interface RetrievalMetadata {
  /** Number of candidates pulled from the vector store before reranking. */
  candidates: number;
  /** Number of sources kept after reranking. */
  finalCount: number;
  /** Top-1 cosine similarity, 0..1. */
  topScore: number;
  /** Wall time spent in retrieval (embed + query + rerank), ms. */
  latencyMs: number;
  /** Embedding model used, e.g. "voyage-code-3". */
  embeddingModel: string;
}

// ---------- Errors ----------------------------------------------------------

/**
 * Stable, machine-readable error codes. The UI uses these to decide whether
 * to show a retry button, a "no results found" message, or a generic error.
 */
export type ChatErrorCode =
  | "VALIDATION_FAILED"
  | "RETRIEVAL_EMPTY"
  | "RETRIEVAL_LOW_CONFIDENCE"
  | "LLM_4XX"
  | "LLM_5XX"
  | "LLM_TIMEOUT"
  | "INTERNAL";

/**
 * Shape of the JSON error body we return when the route handler fails
 * before/while setting up the stream. (Once we're streaming, errors are
 * sent as a `data-error` part instead so the client can render them
 * inline with the partial answer.)
 */
export interface ChatErrorResponse {
  code: ChatErrorCode;
  message: string;
  /** Optional request ID for log correlation. */
  requestId?: string;
}

// ---------- Eval ------------------------------------------------------------

/**
 * One row in our offline evaluation set. See ARCHITECTURE.md §7.
 */
export interface EvalCase {
  id: string;
  category: "factual" | "howto" | "code" | "edge-case" | "multi-doc";
  question: string;
  /**
   * Source IDs (matching the Source.id field) that MUST appear in the
   * retriever's top-K. The eval runner computes MRR and hit-rate from this.
   */
  expectedSources: SourceId[];
  /**
   * Substrings that the final LLM answer must include. We keep these
   * loose ("should mention 'pgvector'") to avoid over-fitting to a specific
   * phrasing.
   */
  expectedAnswerContains: string[];
  /** Minimum top-1 similarity to consider the case a "pass", 0..1. */
  minScore: number;
  notes?: string;
}

/**
 * The result of running one EvalCase.
 */
export interface EvalResult {
  caseId: string;
  passed: boolean;
  retrieval: {
    firstRelevantRank: number | null;
    top5Hit: boolean;
    topScore: number;
  };
  answer: {
    containsAllExpected: boolean;
    /** 0..3, produced by an LLM-as-judge prompt. */
    groundedness: number;
  };
  latency: {
    retrievalMs: number;
    generationMs: number;
    totalMs: number;
  };
}
