/**
 * src/lib/vector-store-reader.ts
 * ----------------------------------------------------------------------------
 * Read-only wrapper around the project's `VectorStore` interface.
 *
 * Why a separate reader (and not just importing the writer):
 *   The ingestion agent owns the *write* path: it chunks documents, embeds
 *   them, and upserts vectors. The retrieval agent (this file's consumer)
 *   only ever *reads*. Mixing read and write code in one module creates
 *   a circular import temptation and a leaky abstraction — the reader
 *   shouldn't pull in any chunking or embed-batch code.
 *
 *   This file defines the smallest surface area the RAG pipeline needs
 *   and re-exports it under a domain-specific name so call sites read
 *   clearly (`readVectorStore().query(...)`).
 *
 * Why we wrap at all (vs. importing `getVectorStore` directly):
 *   - Adds a layer where we can layer in caching, retry, or tracing
 *     without touching every retrieval call site.
 *   - Tests can mock this module without having to mock the underlying
 *     `getVectorStore` factory.
 *   - Keeps the types the RAG code sees tightly scoped — the full
 *     `VectorStore` interface has methods we don't use here.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";

/**
 * A single retrieved chunk with its vector and metadata.
 *
 * Why we keep this minimal:
 *   Retrieval only needs the text (for the prompt) and a stable id
 *   (for the citation). Embeddings and raw scores are intermediate
 *   values that never leave this module.
 */
export interface RetrievedChunk {
  /** Stable id matching the corpus (`namespace/slug#chunkIndex`). */
  id: string;
  /** The chunk text, exactly as it was stored. */
  text: string;
  /** Optional pre-computed metadata from the ingestion side. */
  metadata?: Record<string, unknown>;
  /** Cosine similarity to the query, 0..1. */
  score: number;
}

/**
 * The shape of the store we read from. We deliberately don't depend on
 * the full `VectorStore` type from `vector/types.ts` — the retrieval
 * pipeline only needs `query` (and an optional `embed` is handled
 * separately by the embed-agent).
 *
 * Why a structural type:
 *   Makes the reader trivially mockable in tests. A `MockVectorReader`
 *   with the same shape is assignable without inheritance.
 */
export interface VectorReader {
  /**
   * Query the store with a pre-computed embedding and return the top-K
   * most similar chunks.
   */
  query(
    embedding: number[],
    options: { topK: number; minScore?: number },
  ): Promise<RetrievedChunk[]>;
}

/**
 * The lazy/cached handle to the project's vector reader.
 *
 * Why a module-level cache:
 *   - Avoids re-instantiating the store (and re-loading fixtures) on
 *     every request.
 *   - Tests can reset it via `_resetReaderForTesting()`.
 */
let cachedReader: VectorReader | null = null;

/**
 * Reset the cached reader. Test-only escape hatch.
 *
 * Why this exists:
 *   Tests that inject a different reader need a way to undo the cache
 *   without monkey-patching the module. Production code should never
 *   call this.
 */
export function _resetReaderForTesting(): void {
  cachedReader = null;
}

/**
 * Adapt a `VectorStore.query()` result into our `RetrievedChunk` shape.
 *
 * Why a separate function:
 *   The full `VectorStore` returns its own `QueryResult` type with more
 *   fields than we need. Normalizing here means retrieval code can be
 *   written against `RetrievedChunk` and not worry about the underlying
 *   type's quirks.
 */
function adaptQueryResult(raw: {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}): RetrievedChunk {
  // Why: the corpus stores chunk text under `metadata.text` (see
  // vector/schema.ts in the vector-agent's territory). We pull it out
  // here so retrieval can work with a single `text` field.
  const metadata = raw.metadata ?? {};
  const text =
    typeof metadata["text"] === "string" ? (metadata["text"] as string) : "";
  return {
    id: raw.id,
    text,
    metadata,
    score: raw.score,
  };
}

/**
 * Build a `VectorReader` from the project's `getVectorStore()` factory.
 *
 * Why a factory function (not just a top-level constant):
 *   - Lazy: the underlying store may open a DB connection. We don't want
 *     to do that at module import time (which would break `MOCK=1` paths).
 *   - Testable: tests can pass a mock `VectorStore`-shaped object.
 */
export async function getVectorReader(
  // Allow tests to inject a pre-built reader.
  injected?: VectorReader,
): Promise<VectorReader> {
  if (injected) return injected;
  if (cachedReader) return cachedReader;

  // Why dynamic import: avoids a hard module-load dependency on the
  // vector-agent's code. If that agent's module isn't ready, this
  // defers the failure to first use.
  const { getVectorStore } = await import("@/lib/vector");
  const store = await getVectorStore();

  // The default index name. The ingest pipeline writes to
  // `mastra_docs`; readers query the same. Centralized here so a
  // future "multi-corpus" feature only has to override this string.
  const INDEX_NAME = "mastra_docs";

  cachedReader = {
    async query(embedding, options) {
      const { topK, minScore } = options;
      log.debug({ topK, minScore }, "reader.query.start");

      // The unified `VectorStore.query` takes (indexName, vector, opts).
      // We pin the index name above and forward the rest.
      const results = await store.query(INDEX_NAME, embedding, {
        topK,
        ...(typeof minScore === "number" ? { minScore } : {}),
      });

      const adapted = results.map(adaptQueryResult);
      const filtered =
        typeof minScore === "number"
          ? adapted.filter((c: RetrievedChunk) => c.score >= minScore)
          : adapted;

      log.debug(
        { requested: topK, returned: filtered.length, topScore: filtered[0]?.score ?? 0 },
        "reader.query.done",
      );
      return filtered;
    },
  };

  return cachedReader;
}
