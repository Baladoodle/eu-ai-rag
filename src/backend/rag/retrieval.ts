/**
 * src/backend/rag/retrieval.ts
 * ----------------------------------------------------------------------------
 * Step 1 of the RAG pipeline: retrieve the top-K most relevant chunks for
 * a user query.
 *
 * What "retrieval" means in RAG (educational):
 *   Given a natural-language question, find the passages in the corpus
 *   most likely to contain the answer. The classical approach is:
 *     1. Embed the question with the *same* model used to embed the
 *        corpus (otherwise the similarity math is meaningless).
 *     2. Compare the question's vector to every chunk's vector via
 *        cosine similarity.
 *     3. Take the top-K highest-scoring chunks.
 *   This module does exactly that. Generation (the LLM step) is
 *   separate — see `generation.ts`.
 *
 * Why we have a "retrieval step" at all:
 *   LLMs have a finite context window and don't know about your private
 *   docs. Retrieval surfaces the right *external* knowledge into the
 *   prompt, so the LLM can answer questions it would otherwise have to
 *   guess at (and hallucinate).
 *
 * Why top-K and not "all chunks":
 *   - Cost: every token in the prompt costs money and latency. We want
 *     only the most relevant passages.
 *   - Signal-to-noise: too many chunks drowns the good ones and
 *     encourages the LLM to mix in irrelevant context.
 *
 * Why we re-rank (when the underlying reader returns a reranked list):
 *   Pure vector similarity can be fooled by surface-form overlap ("how
 *   do I install Mastra?" might match an "installation error" page
 *   about the *opposite* of what the user wants). A re-ranker — usually
 *   a cross-encoder — re-scores the candidates with the full query/
 *   chunk pair as input. We keep this step optional because the
 *   in-memory dev store doesn't have a re-ranker.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";
import {
  getVectorReader,
  type RetrievedChunk,
  type VectorReader,
} from "@/lib/vector-store-reader";

/**
 * How many chunks to ask the vector store for. We over-fetch (10) so the
 * optional re-ranker has room to swap in better candidates. The prompt
 * builder will truncate to a final number (e.g. 5) anyway.
 */
const DEFAULT_TOP_K = 10;

/**
 * Below this cosine similarity we treat the chunk as noise and drop it.
 *
 * Why a floor:
 *   pgvector will happily return "best" results that are still terrible.
 *   Filtering at 0.5 means the LLM never sees a chunk that a human
 *   wouldn't immediately dismiss.
 *
 * Why 0.5 specifically:
 *   Empirically a good cut for voyage-code-3 normalized vectors. If
 *   MRR drops below target, tune this in evals.
 */
const DEFAULT_MIN_SCORE = 0.5;

/**
 * The public result of a retrieval call.
 *
 * Why we expose `queryEmbedding`:
 *   Generation sometimes needs to know "what was the question, in
 *   vector form" for downstream telemetry / debug panels.
 */
export interface RetrievalResult {
  chunks: RetrievedChunk[];
  metadata: {
    /** Number of candidates the vector store returned *before* filtering. */
    candidates: number;
    /** Number of chunks kept *after* score thresholding. */
    finalCount: number;
    /** Highest cosine similarity across the result set (0..1). */
    topScore: number;
    /** Wall time spent in retrieval (embed + query + filter), ms. */
    latencyMs: number;
    /** The embedding model used, e.g. "voyage-code-3". */
    embeddingModel: string;
  };
  queryEmbedding: number[];
}

/**
 * Embedding function — abstracted so we can swap Voyage for a mock in
 * tests and so this file doesn't import the Voyage SDK directly.
 */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/**
 * Default options for `retrieve()`. Exported so tests can pass a partial
 * and rely on the rest.
 */
export interface RetrieveOptions {
  topK?: number;
  minScore?: number;
  reader?: VectorReader;
  embed?: EmbedFn;
}

/**
 * Retrieve the most relevant chunks for a user query.
 *
 * Why this is async:
 *   Embedding the query and querying the vector store are both network
 *   calls; the re-ranker (if any) is a third. We don't want callers to
 *   block.
 *
 * Why we log at info level on the boundary:
 *   `chat.start` and `retrieval.final` are the two events that show up
 *   in Vercel logs for every chat turn. If either is missing, something
 *   is broken end-to-end.
 */
export async function retrieve(
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievalResult> {
  const startedAt = Date.now();
  const topK = options.topK ?? DEFAULT_TOP_K;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;

  log.info({ topK, minScore, queryLength: query.length }, "retrieval.start");

  // Why: if the query is empty there's nothing to embed. Returning early
  // here prevents an unnecessary Voyage call (and an unhelpful 0-vector).
  if (!query.trim()) {
    log.warn("retrieval.empty_query");
    return {
      chunks: [],
      metadata: {
        candidates: 0,
        finalCount: 0,
        topScore: 0,
        latencyMs: Date.now() - startedAt,
        embeddingModel: getEmbeddingModelId(),
      },
      queryEmbedding: [],
    };
  }

  // 1. Embed the query. We delegate to the embed-agent's function —
  //    this file does NOT know about Voyage directly.
  const embed = options.embed ?? (await getDefaultEmbedder());
  const embeddings = await embed([query]);
  const queryEmbedding = embeddings[0] ?? [];

  // 2. Resolve the reader (with optional injection for tests).
  const reader = options.reader ?? (await getVectorReader());

  // 3. Query the store. The reader handles normalization/similarity math.
  const raw = await reader.query(queryEmbedding, { topK, minScore });

  // 4. Compute the result metadata.
  const topScore = raw[0]?.score ?? 0;
  const latencyMs = Date.now() - startedAt;

  log.info(
    {
      candidates: raw.length,
      finalCount: raw.length,
      topScore,
      latencyMs,
    },
    "retrieval.final",
  );

  // Why warn here, not in the route: the route is the wrong place to
  // decide what's "good enough". The retrieval layer owns that
  // knowledge and surfaces it via metadata.
  if (raw.length === 0) {
    log.warn({ topScore }, "retrieval.empty_results");
  } else if (topScore < 0.6) {
    log.warn({ topScore }, "retrieval.low_confidence");
  }

  return {
    chunks: raw,
    metadata: {
      candidates: raw.length,
      finalCount: raw.length,
      topScore,
      latencyMs,
      embeddingModel: getEmbeddingModelId(),
    },
    queryEmbedding,
  };
}

/**
 * Lazy default embedder — the embed-agent owns the actual Voyage wrapper.
 *
 * Why dynamic import:
 *   Avoids a hard module-load-time dependency on Voyage. If the user is
 *   running with `MOCK=1` and the Voyage SDK isn't fully configured,
 *   we still want retrieval to work end-to-end.
 */
async function getDefaultEmbedder(): Promise<EmbedFn> {
  const mod = await import("@/lib/rag/embed");
  // Why `as unknown as EmbedFn`:
  //   The embed-agent exposes `embed(texts: string[]): Promise<number[][]>`.
  //   Our `EmbedFn` is the same shape. The cast documents the contract
  //   without forcing both sides to import a shared type.
  return mod.embed as unknown as EmbedFn;
}

/**
 * Read the configured embedding model id from env.
 *
 * Why a function (vs. an exported constant):
 *   Tests can change the env between runs and we want a fresh read.
 */
function getEmbeddingModelId(): string {
  return process.env.EMBEDDING_MODEL ?? "voyage-code-3";
}
