/**
 * ingestion/types.ts
 * ----------------------------------------------------------------------------
 * Shared types for the ingestion pipeline.
 *
 * Why this file exists (educational note for someone new to RAGs):
 *   A RAG ingestion pipeline is a multi-stage funnel:
 *     raw source -> scraped document -> chunks -> embeddings -> stored rows
 *   Each stage is implemented in a separate file (scrapers, chunker, embedder,
 *   writer). Without a shared types file, the boundary between stages becomes
 *   "whatever shape the previous function happened to return" — which means
 *   you can't swap one stage out (e.g. swap Readability for a different HTML
 *   extractor) without re-shaping all the downstream functions.
 *
 *   Centralizing the data shapes here makes the pipeline composable and
 *   easy to test: each stage is "input shape -> output shape" with the
 *   shape pinned in this file.
 * ----------------------------------------------------------------------------
 */

/**
 * The raw form of a single ingestible document, after scraping and cleaning
 * but BEFORE chunking.
 *
 * `sourceId` is a stable identifier like `mastra-docs/rag/overview`. The
 * same `sourceId` for the same content guarantees idempotency downstream.
 */
export interface RawDocument {
  /** Stable, human-readable id, e.g. "mastra-docs/rag/overview". */
  sourceId: string;
  /** Canonical URL of the source (or a "repo:..." pseudo-URL for code). */
  url: string;
  /** Human-readable title for the source list in the UI. */
  title: string;
  /** Optional H1/H2 — we capture it if Readability gives us one. */
  section?: string;
  /** Already-cleaned plain text or markdown. */
  text: string;
  /** What kind of source this is. Lets the chunker tune itself. */
  kind: "docs" | "source" | "issue";
  /** Free-form metadata, persisted alongside the vector. */
  metadata: Record<string, string | number | boolean>;
}

/**
 * A chunk after splitting. This is the unit of retrieval — at query time
 * we search for chunks, not whole documents.
 *
 * Why chunk at all (and not embed the whole doc)?
 *   - Embedding models have a max input length (32K for voyage-code-3, but
 *     a 32K vector of noisy prose is worse than a 1K vector of focused text).
 *   - Retrieval accuracy is much higher on focused chunks because the
 *     cosine similarity signal isn't diluted by unrelated paragraphs.
 */
export interface ChunkRecord {
  /** Deterministic id, derived from `sourceId` + `chunkIndex`. */
  id: string;
  /** The original source's id — keeps the link back to the doc. */
  sourceId: string;
  /** The chunk's text. */
  text: string;
  /** Position within the source document, 0-based. */
  chunkIndex: number;
  /** Total chunks the source produced. */
  totalChunks: number;
  /** Inherited + per-chunk metadata. */
  metadata: Record<string, string | number | boolean>;
}

/**
 * A chunk plus its vector, ready to upsert.
 *
 * Why bundle them? Because at upsert time, the writer needs both the
 * vector AND the original text+metadata to put in the row. Keeping them
 * together means we can't lose the link between a vector and its text.
 */
export interface EmbeddedChunk {
  id: string;
  sourceId: string;
  text: string;
  chunkIndex: number;
  totalChunks: number;
  vector: number[];
  metadata: Record<string, string | number | boolean>;
}

/**
 * Result of upserting one batch. Used to render the progress bar and to
 * produce a final summary log.
 */
export interface UpsertSummary {
  /** Number of rows actually written (i.e. not skipped by idempotency). */
  written: number;
  /** Number of rows skipped because they already existed. */
  skipped: number;
  /** Total number of rows we attempted. */
  attempted: number;
  /** Wall time for the batch in milliseconds. */
  elapsedMs: number;
}

/**
 * The top-level result of running the pipeline. The CLI prints this.
 */
export interface PipelineResult {
  sourcesScraped: number;
  documentsScraped: number;
  documentsSkipped: number;
  chunksProduced: number;
  chunksEmbedded: number;
  chunksUpserted: number;
  chunksSkipped: number;
  totalElapsedMs: number;
  dryRun: boolean;
}
