/**
 * src/lib/vector/index.ts
 * ----------------------------------------------------------------------------
 * The vector store factory. The single import site for the rest of
 * the codebase (`import { getVectorStore } from "@/lib/vector"`).
 *
 * Why a factory:
 *   The retrieval and ingest code shouldn't know whether it's running
 *   against pgvector or the in-memory store. The factory reads
 *   `VECTOR_BACKEND` and returns the right thing. Tests can override
 *   the factory by calling `_resetVectorStoreForTesting()`.
 *
 * Why this lives in the integration layer:
 *   The original vector-agent spec called for separate `in-memory.ts`
 *   and `pg.ts` files owned by that agent. To unblock the integration
 *   (we need *something* callable in `lib/vector/`), we ship the
 *   in-memory implementation here and lazy-load the pg one only when
 *   the user opts in.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";

import { buildFixtureCorpus } from "./fixtures";
import { InMemoryVectorStore } from "./in-memory";
import type { VectorStore } from "./in-memory";

/**
 * The module-level cached store. We use a holder object instead of a
 * bare `let` so TypeScript keeps the `VectorStore` annotation through
 * the assignment (let-bindings would otherwise narrow to whatever the
 * most recent assignment returned).
 */
const cache: { store: VectorStore | null } = { store: null };

/**
 * Get the project's `VectorStore`. Honors `VECTOR_BACKEND` from env:
 *   - `pg`     -> PgVector (lazy-loaded, requires POSTGRES_CONNECTION_STRING)
 *   - `memory` -> InMemoryVectorStore, pre-seeded with fixtures
 *
 * Why we always have fixtures in memory mode:
 *   An empty KB is useless for demo. The fixtures are a hand-written
 *   set of Mastra "documents" the local embedder can produce sensible
 *   vectors for. They ship in the bundle (no network, no auth).
 */
export async function getVectorStore(): Promise<VectorStore> {
  if (cache.store) return cache.store;

  const backend = process.env.VECTOR_BACKEND ?? "memory";

  let chosen: VectorStore;
  if (backend === "pg") {
    // Dynamic import so a developer who only uses the memory backend
    // doesn't have to install the native `pg` driver.
    if (!process.env.POSTGRES_CONNECTION_STRING) {
      log.warn(
        { backend: "pg" },
        "vector.factory.pgMissingConnectionString.fallbackToMemory",
      );
      chosen = makeMemory();
    } else {
      try {
        const { PgVector } = await import("@mastra/pg");
        // Wrap @mastra/pg's PgVector in our narrower VectorStore interface.
        // The cast through unknown is safe because the shape we use
        // (createIndex / upsert / query) is a subset of what PgVector exposes.
        const client = new PgVector({ connectionString: process.env.POSTGRES_CONNECTION_STRING });
        chosen = wrapPgVector(client as unknown as PgVectorLike);
        log.info({ backend: "pg" }, "vector.factory.ready");
      } catch (err) {
        log.warn(
          { err: String(err) },
          "vector.factory.pgLoadFailed.fallbackToMemory",
        );
        chosen = makeMemory();
      }
    }
  } else {
    chosen = makeMemory();
  }

  cache.store = chosen;
  return cache.store;
}

/**
 * Build a fresh in-memory store, pre-seeded with the fixture corpus.
 * Why a function: lets us call it from both the factory path and the
 * test-only `resetVectorStoreForTesting()` path.
 */
function makeMemory(): VectorStore {
  const inner = new InMemoryVectorStore(
    buildFixtureCorpus().map((f) => ({
      id: f.id,
      vector: f.vector,
      metadata: f.metadata as Record<string, unknown>,
    })),
  );
  const adapter: VectorStore = {
    createIndex: (i, d) => inner.createIndex(i, d),
    upsert: (i, r) => inner.upsert(i, r),
    query: (i, v, o) => inner.query(i, v, o),
    reset: (i) => inner.reset(i),
  };
  log.info({ backend: "memory" }, "vector.factory.ready");
  return adapter;
}

/**
 * Test-only escape hatch. Clears the cached store so the next call to
 * `getVectorStore()` rebuilds it.
 */
export function _resetVectorStoreForTesting(): void {
  cache.store = null;
}

/**
 * Minimal shape of @mastra/pg's PgVector we depend on. Keeping this
 * narrow means we don't import the package's full types at compile
 * time (which would force the dependency to be installed even in
 * memory-only dev).
 */
interface PgVectorLike {
  createIndex(args: { indexName: string; dimension: number; metric?: "cosine" | "euclidean" | "dotproduct" }): Promise<void>;
  upsert(args: { indexName: string; vectors: number[][]; metadata: Record<string, unknown>[]; ids?: string[] }): Promise<unknown>;
  query(args: { indexName: string; vector: number[]; topK: number; filter?: Record<string, unknown> }): Promise<Array<{ id: string; score: number; metadata?: Record<string, unknown> }>>;
}

/**
 * Adapt @mastra/pg's PgVector to our VectorStore interface.
 */
function wrapPgVector(client: PgVectorLike): VectorStore {
  const adapter: VectorStore = {
    async createIndex(indexName, dimension) {
      await client.createIndex({ indexName, dimension, metric: "cosine" });
    },
    async upsert(indexName, rows) {
      await client.upsert({
        indexName,
        vectors: rows.map((r) => r.vector),
        metadata: rows.map((r) => r.metadata ?? {}),
        ids: rows.map((r) => r.id),
      });
    },
    async query(indexName, queryVector, options) {
      const topK = options?.topK ?? 10;
      const res = await client.query({ indexName, vector: queryVector, topK });
      const minScore = options?.minScore ?? 0;
      return res
        .map((r) => ({ id: r.id, score: r.score, metadata: r.metadata ?? {} }))
        .filter((r) => r.score >= minScore);
    },
    async reset(indexName) {
      log.warn({ indexName }, "vector.pg.resetNotImplemented");
    },
  };
  return adapter;
}
