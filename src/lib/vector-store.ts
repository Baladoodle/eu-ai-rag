/**
 * lib/vector-store.ts
 * ----------------------------------------------------------------------------
 * The WRITER half of the vector store contract. The read path lives in
 * `src/lib/vector-store-reader.ts`; the unified store (createIndex +
 * upsert + query) lives in `src/lib/vector/`. This file is the narrow
 * interface the ingest pipeline uses plus a factory that picks the
 * right backend.
 *
 * Why a separate writer (educational note):
 *   The ingest pipeline has one job: get chunks into the store. It
 *   does NOT need the full VectorStore interface (no query, no
 *   createIndex from the pipeline's side). Depending on the full
 *   interface would couple the pipeline to every other concern. The
 *   narrow `VectorWriter` interface below is enough for ingest and
 *   nothing else.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";
import type { EmbeddedChunk, UpsertSummary } from "@/ingestion/types";

import { getVectorStore } from "@/lib/vector";

/** The minimum interface the ingest pipeline needs. */
export interface VectorWriter {
  /**
   * Upsert a batch of embedded chunks. Returns counts of written vs
   * skipped rows.
   *
   * Idempotency: re-upserting the same id is a no-op.
   */
  upsert(batch: ReadonlyArray<EmbeddedChunk>): Promise<UpsertSummary>;
}

const INDEX_NAME = "mastra_docs";

/**
 * Lazy, in-memory writer. Used in dev (`VECTOR_BACKEND=memory`) and in
 * tests. Persists nothing — process restart = empty store.
 *
 * Why we keep a writer here (and not just rely on the unified store):
 * the ingest pipeline's contract is "give me a writer", and we don't
 * want the pipeline to import the full VectorStore just to get the
 * upsert method.
 */
class InMemoryWriter implements VectorWriter {
  private rows: Map<string, EmbeddedChunk> = new Map();

  upsert(batch: ReadonlyArray<EmbeddedChunk>): Promise<UpsertSummary> {
    const started = Date.now();
    let written = 0;
    let skipped = 0;
    for (const row of batch) {
      if (this.rows.has(row.id)) {
        skipped++;
        continue;
      }
      this.rows.set(row.id, row);
      written++;
    }
    return Promise.resolve({
      written,
      skipped,
      attempted: batch.length,
      elapsedMs: Date.now() - started,
    });
  }

  /** For tests: snapshot the rows. */
  snapshot(): EmbeddedChunk[] {
    return [...this.rows.values()];
  }
}

/**
 * pgvector-backed writer. Delegates to the unified VectorStore.
 *
 * Why we go through the unified store (vs. instantiating PgVector
 * directly): the @mastra/pg surface is broader than the ingest
 * pipeline needs. Centralizing the choice in `lib/vector/` keeps
 * ingestion code simple.
 */
class PgWriter implements VectorWriter {
  private indexName: string = INDEX_NAME;
  private ready: Promise<void>;

  constructor(indexName: string = INDEX_NAME) {
    this.indexName = indexName;
    // Touch the store at construction time so the first call to
    // `upsert()` doesn't pay the cold-start cost.
    const indexNameCopy = this.indexName;
    this.ready = (async () => {
      const store: Awaited<ReturnType<typeof getVectorStore>> = await getVectorStore();
      // We pick 1024 as the default dimension; the production embedder
      // is voyage-code-3 which produces 1024-dim vectors.
      try {
        await store.createIndex(indexNameCopy, 1024);
      } catch (err) {
        log.debug({ err: String(err) }, "vectorStore.indexExists");
      }
    })();
  }

  async upsert(batch: ReadonlyArray<EmbeddedChunk>): Promise<UpsertSummary> {
    const started = Date.now();
    if (batch.length === 0) {
      return { written: 0, skipped: 0, attempted: 0, elapsedMs: 0 };
    }
    await this.ready;
    const store = await getVectorStore();
    await store.upsert(
      this.indexName,
      batch.map((b) => ({
        id: b.id,
        vector: b.vector,
        metadata: {
          sourceId: b.sourceId,
          chunkIndex: b.chunkIndex,
          totalChunks: b.totalChunks,
          text: b.text,
          ...b.metadata,
        },
      })),
    );
    return {
      written: batch.length,
      skipped: 0,
      attempted: batch.length,
      elapsedMs: Date.now() - started,
    };
  }
}

let cached: VectorWriter | null = null;
let cachedMemory: InMemoryWriter | null = null;

/** Get the in-memory writer (used by tests and dev dry-runs). */
export function getInMemoryWriter(): InMemoryWriter {
  if (!cachedMemory) cachedMemory = new InMemoryWriter();
  return cachedMemory;
}

/**
 * Factory: returns a writer appropriate for the current environment.
 *
 * Why a factory (and not just `new PgWriter(...)` at the call site):
 * the pipeline shouldn't need to know which backend exists. It
 * imports one symbol, gets the right thing, and moves on.
 */
export function getVectorWriter(): VectorWriter {
  if (cached) return cached;
  const backend = process.env.VECTOR_BACKEND ?? "memory";
  if (backend === "pg" && process.env.POSTGRES_CONNECTION_STRING) {
    cached = new PgWriter(INDEX_NAME);
    log.info({ backend: "pg" }, "vectorStore.using");
  } else {
    cached = getInMemoryWriter();
    log.info({ backend: "memory" }, "vectorStore.using");
  }
  return cached;
}
