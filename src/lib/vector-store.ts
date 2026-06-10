/**
 * lib/vector-store.ts
 * ----------------------------------------------------------------------------
 * The WRITER half of the vector store contract. The read path is
 * implemented elsewhere (`src/lib/vector/in-memory.ts`,
 * `src/lib/vector/pg.ts` — owned by vector-agent). This file is the
 * thin shared interface + a factory the ingest pipeline can call
 * without caring about the backend.
 *
 * Why a separate writer file (educational note for someone new to RAGs):
 *   The ingest pipeline has one job: get chunks into the store. It
 *   does NOT need the full VectorStore interface (no query, no
 *   createIndex, no filter expressions). Depending on the full
 *   interface would mean coupling the pipeline to every other
 *   concern. The narrow `VectorWriter` interface below is enough
 *   for ingest and nothing else.
 * ----------------------------------------------------------------------------
 */
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import type { EmbeddedChunk, UpsertSummary } from "@/ingestion/types";

/** Minimum interface the ingest pipeline needs. Both backends implement it. */
export interface VectorWriter {
  /**
   * Upsert a batch of embedded chunks. Returns counts of written vs
   * skipped rows.
   *
   * Idempotency contract: an upsert with an existing id should NOT
   * create a duplicate row. If the backend supports it, the writer
   * should also short-circuit on the content hash so we don't even
   * round-trip for chunks we've seen before.
   */
  upsert(batch: ReadonlyArray<EmbeddedChunk>): Promise<UpsertSummary>;
}

/**
 * Lazy, in-memory implementation. Used in dev (`VECTOR_BACKEND=memory`)
 * and in tests. Persists nothing — process restart = empty store.
 *
 * Why we keep a writer here (and not just rely on the vector-agent's
 * in-memory store): the ingest pipeline's contract is "give me a
 * writer", and we don't want the pipeline to import the full
 * VectorStore just to get the upsert method. This stub keeps the
 * pipeline runnable end-to-end with zero external services.
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
 * pgvector-backed writer. We dynamically import `@mastra/pg` so a
 * developer who only has the `memory` backend doesn't have to install
 * the native `pg` driver.
 */
class PgWriter implements VectorWriter {
  // We type as `unknown` here to avoid leaking the @mastra/pg types
  // into the rest of the codebase. The shape we use is documented
  // by @mastra/pg: `upsert({ indexName, vectors, metadata })`.
  private client: unknown;
  private indexName: string;

  constructor(client: unknown, indexName = "mastra_docs") {
    this.client = client;
    this.indexName = indexName;
  }

  async upsert(batch: ReadonlyArray<EmbeddedChunk>): Promise<UpsertSummary> {
    const started = Date.now();
    if (batch.length === 0) {
      return { written: 0, skipped: 0, attempted: 0, elapsedMs: 0 };
    }

    // The Mastra PgVector API:
    //   upsert({ indexName, vectors: number[][], metadata: ..., ids?: string[] })
    // We pass `ids` so the SQL is an UPSERT keyed on id (idempotent).
    const vectors = batch.map((b) => b.vector);
    const metadata = batch.map((b) => ({
      sourceId: b.sourceId,
      chunkIndex: b.chunkIndex,
      totalChunks: b.totalChunks,
      text: b.text,
      ...b.metadata,
    }));
    const ids = batch.map((b) => b.id);

    // We invoke the SDK through a narrow, typed boundary. The cast
    // is necessary because @mastra/pg's types are stricter than we
    // need for the ingest-time upsert (it cares about filter keys,
    // which we don't use here).
    const c = this.client as {
      upsert: (args: {
        indexName: string;
        vectors: number[][];
        metadata: Record<string, unknown>[];
        ids?: string[];
      }) => Promise<{ rows?: unknown[] }>;
      createIndex: (args: {
        indexName: string;
        dimension: number;
        metric?: "cosine" | "euclidean" | "dotproduct";
      }) => Promise<void>;
    };

    // Best-effort index creation. Mastra's createIndex is idempotent
    // on most backends, but we don't want to fail the whole batch
    // if the index already exists with a different dim.
    try {
      await c.createIndex({ indexName: this.indexName, dimension: vectors[0]!.length, metric: "cosine" });
    } catch (err) {
      log.debug({ err: String(err) }, "vectorStore.indexExists");
    }

    await c.upsert({ indexName: this.indexName, vectors, metadata, ids });

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
 * The decision is governed by `VECTOR_BACKEND` (see env.ts).
 *
 * Why a factory (and not just `new PgWriter(...)` at the call site):
 * the pipeline shouldn't need to know which backend exists. It
 * imports one symbol, gets the right thing, and moves on.
 */
export function getVectorWriter(): VectorWriter {
  if (cached) return cached;

  if (env.VECTOR_BACKEND === "pg") {
    if (!env.POSTGRES_CONNECTION_STRING) {
      throw new Error("VECTOR_BACKEND=pg but POSTGRES_CONNECTION_STRING is not set");
    }
    // Dynamic import so memory-only dev doesn't pull in `pg`.
    // The shape we depend on is documented above; we keep the
    // returned client loosely typed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PgVector } = require("@mastra/pg") as { PgVector: new (cfg: { connectionString: string }) => unknown };
    cached = new PgWriter(new PgVector({ connectionString: env.POSTGRES_CONNECTION_STRING }));
    log.info({ backend: "pg" }, "vectorStore.using");
  } else {
    cached = getInMemoryWriter();
    log.info({ backend: "memory" }, "vectorStore.using");
  }
  return cached;
}
