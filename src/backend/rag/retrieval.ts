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
 * How many chunks to ask the vector store for. The final result is
 * handed to the LLM as the "Sources" block in the system prompt.
 *
 * Why 12 (was 8): the citation rules ask the model to cite *the source
 * whose label matches the specific Article number for each claim*. For
 * list-style queries ("what are the four risk categories", "list the
 * obligations of a provider"), this means surfacing both the parent
 * article AND each cross-reference article (Article 4 + Articles 5, 16,
 * 50, 113 for the risk-categories question). 8 chunks is enough for a
 * definition question but too few for a cross-reference-heavy list —
 * the model ends up citing the parent for every list item. 12 covers
 * the typical cross-reference fan-out.
 */
const DEFAULT_TOP_K = 12;

/**
 * Below this cosine similarity we treat the chunk as noise and drop it.
 *
 * Why 0.4 (was 0.5): with voyage-law-2 the cosine distribution shifts
 * down ~0.05 from voyage-code-3. A 0.5 floor was dropping borderline
 * correct articles (Article 16 for "main provider obligations" landed
 * at 0.47 in the pre-fix eval). 0.4 recovers those without flooding
 * the prompt with low-signal noise — the model's "cite only what you
 * draw from" rule is the real filter.
 */
const DEFAULT_MIN_SCORE = 0.4;

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
    /**
     * True when this result was obtained via the broad-fallback pass
     * (the strict pass returned zero and we re-queried at a lower
     * threshold). The pipeline uses this to relax the
     * empty-retrieval refusal threshold — borderline-but-non-zero
     * retrieval is now a generation, not a refusal.
     */
    usedBroadFallback: boolean;
    /** Number of distinct articles represented in the result. Mirrors wire `RetrievalMetadata.uniqueSources`. */
    uniqueSources: number;
    /** Largest chunk count from any single article in the result. Mirrors wire `RetrievalMetadata.maxPerArticle`. */
    maxPerArticle: number;
  };
  queryEmbedding: number[];
}

/**
 * Embedding function — abstracted so we can swap Voyage for a mock in
 * tests and so this file doesn't import the Voyage SDK directly.
 */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/**
 * The fallback minimum score used when the first pass returns zero
 * results. Lower than `DEFAULT_MIN_SCORE` because at that point we'd
 * rather feed borderline-but-plausible context to the LLM and let the
 * prompt's "cite only the sources block" rule discipline the answer
 * than refuse outright.
 *
 * Why 0.15 (was 0.2): for list-style queries ("what are the four risk
 * categories", "list the provider obligations"), the cross-reference
 * articles (e.g. Article 50 for limited-risk transparency obligations)
 * land between 0.15-0.25 in voyage-law-2 cosine. A 0.2 floor was
 * excluding them, leaving the model to cite only the parent article
 * (Article 4) for every list item. 0.15 surfaces the cross-references
 * without admitting noise.
 */
const DEFAULT_BROAD_MIN_SCORE = 0.15;

/**
 * A wider `topK` for the fallback pass. The first pass asks for the
 * default 10; the fallback widens to 20 so a borderline question can
 * still see related articles even if they're not in the top 10.
 */
const BROAD_TOP_K = 20;

/**
 * Max chunks per single article in the final result. Why 3: enough to
 * preserve cross-clause grounding within a high-relevance article, low
 * enough to force a diverse source list when several articles match.
 * Disable per-call via `perArticleCap: null`.
 */
const DEFAULT_PER_ARTICLE_CAP = 3;

/**
 * How many extra candidates to pull per pass so the cap has room to pick
 * from. STRICT = topK*4 lets a clustered query still surface multiple
 * articles; BROAD = broadTopK*2 is enough margin for the lower-score
 * rescue pass without exploding prompt cost.
 */
const STRICT_CANDIDATE_MULTIPLIER = 4;
const BROAD_CANDIDATE_MULTIPLIER = 2;

/**
 * Derive the per-article dedup key from a chunk. The ingestion writer
 * (`src/lib/vector-store.ts`) persists `metadata.sourceId` for every
 * chunk; the `chunk.id.split("#")[0]` fallback handles fixtures that
 * were seeded without `sourceId` (legacy path).
 */
function chunkSourceKey(chunk: RetrievedChunk): string {
  const fromMeta = (chunk.metadata as { sourceId?: string } | undefined)?.sourceId;
  if (fromMeta) return fromMeta;
  const hashIdx = chunk.id.indexOf("#");
  return hashIdx > 0 ? chunk.id.slice(0, hashIdx) : chunk.id;
}

/**
 * Greedy per-article selection. Walks candidates in score order, keeps
 * each iff its article has not yet hit `cap`, stops at `topK`.
 *
 * Pure: no I/O, no side effects. Easy to unit-test.
 */
function selectWithCap(
  candidates: RetrievedChunk[],
  topK: number,
  cap: number | null,
): RetrievedChunk[] {
  if (cap === null) return candidates.slice(0, topK);
  const counts = new Map<string, number>();
  const out: RetrievedChunk[] = [];
  for (const c of candidates) {
    const key = chunkSourceKey(c);
    const n = counts.get(key) ?? 0;
    if (n >= cap) continue;
    counts.set(key, n + 1);
    out.push(c);
    if (out.length === topK) break;
  }
  return out;
}

/**
 * Default options for `retrieve()`. Exported so tests can pass a partial
 * and rely on the rest.
 *
 * `broadMinScore` controls the fallback pass — when the first pass
 * returns zero results we re-query with a lower threshold so a
 * borderline question still gets *some* context for the LLM to draw
 * on. Set to `null` to disable the fallback.
 */
export interface RetrieveOptions {
  topK?: number;
  minScore?: number;
  /**
   * Minimum score for the second-pass "broad" query. Defaults to
   * `DEFAULT_BROAD_MIN_SCORE` (0.2). Pass `null` to disable the
   * fallback entirely.
   */
  broadMinScore?: number | null;
  /**
   * `topK` for the broad fallback pass. Defaults to `BROAD_TOP_K` (20).
   */
  broadTopK?: number;
  /**
   * Max chunks per single article in the final result. Defaults to
   * `DEFAULT_PER_ARTICLE_CAP` (3). Pass `null` to disable the cap.
   */
  perArticleCap?: number | null;
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
        usedBroadFallback: false,
        uniqueSources: 0,
        maxPerArticle: 0,
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
  //
  // Diversity contract: when per-article capping is enabled, ask the
  // vector store for `topK * STRICT_CANDIDATE_MULTIPLIER` candidates so
  // the cap has room to pick from. With topK=8 and multiplier=4 we pull
  // 32 candidates; cap=3 then leaves room for ~10 articles. This is
  // the standard cosine-similarity-then-cap-pass pattern (no MMR, no
  // lambda — keeps the model tunable-free and the behavior deterministic).
  const cap = options.perArticleCap === null ? null : options.perArticleCap ?? DEFAULT_PER_ARTICLE_CAP;
  const strictWindow = cap === null ? topK : Math.max(topK, topK * STRICT_CANDIDATE_MULTIPLIER);
  let raw = await reader.query(queryEmbedding, { topK: strictWindow, minScore });
  let usedBroadFallback = false;

  // 3a. Broad pass — ALWAYS run, merge with strict pass.
  //
  // Why always (was: only when strict pass returned zero):
  //   The strict pass surfaces the top-N most-similar chunks. For
  //   questions that ask about a *list* of things ("what are the four
  //   risk categories", "list the obligations of a provider"), the
  //   strict pass typically returns chunks for one or two of the
  //   items — the most semantically central one (e.g. Article 4 for
  //   "risk categories"). The cross-reference articles (Article 16
  //   for high-risk obligations, Article 50 for limited-risk
  //   obligations) score below the topK cutoff but are still
  //   relevant. The prompt's citation rules ask the model to cite
  //   *the source whose label matches the specific Article number
  //   for each claim* — but it can only do that if those articles
  //   are in the sources block.
  //
  //   Always running the broad pass and merging with selectWithCap
  //   surfaces those cross-reference articles without weakening the
  //   strict-pass ranking. The strict-pass articles remain at the
  //   top of the citation order; the broad-pass articles fill in
  //   the supporting slots.
  const broadMinScore =
    options.broadMinScore === null
      ? null
      : options.broadMinScore ?? DEFAULT_BROAD_MIN_SCORE;
  if (broadMinScore !== null) {
    const broadTopK = options.broadTopK ?? BROAD_TOP_K;
    const broadWindow = cap === null ? broadTopK : Math.max(broadTopK, broadTopK * BROAD_CANDIDATE_MULTIPLIER);
    const broadRaw = await reader.query(queryEmbedding, {
      topK: broadWindow,
      minScore: broadMinScore,
    });
    if (broadRaw.length > 0) {
      raw = selectWithCap([...raw, ...broadRaw], topK, cap);
      usedBroadFallback = true;
      log.info(
        {
          broadMinScore,
          broadTopK,
          broadWindow,
          strictKept: raw.length,
          broadKept: broadRaw.length,
          kept: raw.length,
          topScore: raw[0]?.score ?? 0,
        },
        "retrieval.broad_merge",
      );
    } else if (cap !== null) {
      raw = selectWithCap(raw, topK, cap);
    }
  } else if (cap !== null) {
    raw = selectWithCap(raw, topK, cap);
  }

  // 4. Compute the result metadata.
  const topScore = raw[0]?.score ?? 0;
  const latencyMs = Date.now() - startedAt;

  // Compute diversity metrics from the post-cap `raw`.
  // `uniqueSources` = distinct articles represented. `maxPerArticle` =
  // largest chunk count from any single article (caps at `cap` when the
  // cap is enabled). The retrieval.final log mirrors these for ops/debug.
  const perArticleCounts = new Map<string, number>();
  for (const c of raw) {
    const key = chunkSourceKey(c);
    perArticleCounts.set(key, (perArticleCounts.get(key) ?? 0) + 1);
  }
  const uniqueSources = perArticleCounts.size;
  const maxPerArticle =
    perArticleCounts.size === 0 ? 0 : Math.max(...perArticleCounts.values());


  log.info(
    {
      candidates: raw.length,
      finalCount: raw.length,
      uniqueSources,
      maxPerArticle,
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
      usedBroadFallback,
      uniqueSources,
      maxPerArticle,
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
 *   Lazy — the import path is wired in by the embed-agent and we
 *   don't want this module to force-load the Voyage SDK at import
 *   time. The lookup itself is a single env read; making it a
 *   function is the cheaper way to defer that than wiring a getter.
 */
function getEmbeddingModelId(): string {
  return process.env.EMBEDDING_MODEL ?? "voyage-law-2";
}
