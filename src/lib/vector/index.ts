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
      chosen = await makeMemory();
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
        chosen = await makeMemory();
      }
    }
  } else {
    chosen = await makeMemory();
  }

  cache.store = chosen;
  return cache.store;
}

/**
 * Build a fresh in-memory store, pre-seeded with the fixture corpus.
 *
 * Why async:
 *   The fixture corpus is embedded at build time with the *local* hash
 *   embedder (256 dims). If the live embedder is configured (e.g. a
 *   Voyage key is set in `.env.local`), the query side will run at
 *   that embedder's dimension (1024 for voyage-code-3). The two
 *   vector spaces are then incommensurable: cosine similarity between
 *   a 1024-dim query and a 256-dim stored vector is noise, every
 *   retrieval returns 0 chunks, and the user sees an empty refusal.
 *
 *   We close the gap here: if the live embedder's dimension differs
 *   from the fixture's, we re-embed the fixture texts once on startup
 *   so the corpus and queries live in the same space. The cost is a
 *   single batched embed call (10 short passages) and is amortized by
 *   the module-level cache.
 *
 *   If the live call fails (no network, bad key, rate limit), we log
 *   a warning and fall back to the local vectors. The dev path still
 *   works end-to-end on the local embedder; the user just won't get
 *   meaningful results until they either fix the key or unset it.
 *
 * Why a function (vs. inlining into `getVectorStore`):
 *   Lets us call it from both the factory path and the test-only
 *   `resetVectorStoreForTesting()` path.
 */
async function makeMemory(): Promise<VectorStore> {
  const fixtures = buildFixtureCorpus();
  const localDim = fixtures[0]?.vector.length ?? 0;

  // Decide which vectors to seed. Default to the local ones — if we
  // can't reach the live embedder we still want the store usable.
  let seedRows: ReadonlyArray<{ id: string; vector: number[]; metadata: Record<string, unknown> }> =
    fixtures.map((f) => ({
      id: f.id,
      vector: f.vector,
      metadata: f.metadata as Record<string, unknown>,
    }));

  try {
    const { activeEmbeddingDimension, embed } = await import("@/lib/rag/embed") as unknown as {
      activeEmbeddingDimension: () => number;
      embed: (texts: string[]) => Promise<number[][]>;
    };
    const liveDim = activeEmbeddingDimension();
    if (liveDim !== localDim) {
      // Re-embed the fixture texts with the live provider so the
      // corpus matches the query embedder's dimension.
      const texts = fixtures.map((f) => String(f.metadata["text"] ?? ""));
      const liveVectors = await embed(texts);
      if (liveVectors.length === fixtures.length && liveVectors[0]?.length === liveDim) {
        seedRows = fixtures.map((f, i) => ({
          id: f.id,
          vector: liveVectors[i] ?? f.vector,
          metadata: f.metadata as Record<string, unknown>,
        }));
        log.info(
          { from: localDim, to: liveDim, count: liveVectors.length },
          "vector.factory.fixturesReembedded",
        );
      } else {
        log.warn(
          { expected: fixtures.length, got: liveVectors.length, liveDim },
          "vector.factory.embedShapeMismatch.fallbackToLocal",
        );
      }
    }
  } catch (err) {
    // Live embedder unreachable (no key, no network, bad key). The
    // local vectors will still produce a working but semantically
    // weak retrieval when the live embedder is also unreachable;
    // when the live embedder *is* reachable this fallback means
    // scores will look wrong, but the store won't be empty.
    log.warn(
      { err: String(err), localDim },
      "vector.factory.liveEmbedFailed.fallbackToLocal",
    );
  }

  const inner = new InMemoryVectorStore(seedRows);
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
