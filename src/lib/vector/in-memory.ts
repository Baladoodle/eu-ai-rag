/**
 * src/lib/vector/in-memory.ts
 * ----------------------------------------------------------------------------
 * The in-memory vector store. Used in dev and tests; no persistence, no
 * network. Implements the same `VectorStore` interface as the pg-backed
 * store so the retrieval code can swap them out with one line.
 *
 * Why we keep two stores (educational note):
 *   Vector stores differ wildly in capability (filtering, index types,
 *   metadata shape). The `@mastra/rag` package gives us a unified
 *   `VectorStore` interface, but at the application level we want a
 *   smaller surface — the few methods we actually call.
 *
 *   Keeping a minimal Map-backed store in this repo means:
 *     - `npm run dev` works without Postgres.
 *     - Tests are hermetic.
 *     - The dev path never touches the network.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";

/**
 * One row in the in-memory store. The shape mirrors what the
 * @mastra/pg writer produces: a numeric vector plus a metadata bag
 * that contains `text`, `sourceId`, etc.
 */
export interface InMemoryRow {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

/**
 * The full VectorStore interface used by the retrieval + ingest paths.
 * Both the in-memory and pg implementations satisfy it.
 */
export interface VectorStore {
  /** Create an index of the given dimension. Idempotent. */
  createIndex(indexName: string, dimension: number): Promise<void>;
  /** Upsert a batch of (id, vector, metadata) rows. Idempotent on id. */
  upsert(
    indexName: string,
    rows: ReadonlyArray<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>,
  ): Promise<void>;
  /** Top-K most similar rows to the query vector, in descending order. */
  query(
    indexName: string,
    queryVector: number[],
    options?: { topK?: number; minScore?: number },
  ): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>>;
  /** Drop all rows for an index. Used by tests. */
  reset(indexName: string): Promise<void>;
}

/**
 * The default in-memory implementation.
 *
 * Why a Map per index:
 *   - Multiple indices (e.g. one for "mastra_docs", one for "user_uploads")
 *     should not collide. Keeping them in their own map makes that
 *     trivial.
 *   - Map keeps insertion order, which is handy in dev for deterministic
 *     "first N" results.
 */
export class InMemoryVectorStore implements VectorStore {
  private indices: Map<string, Map<string, InMemoryRow>> = new Map();
  private dimensions: Map<string, number> = new Map();

  /**
   * Pre-seeded fixtures. Used by the dev "no API keys" path so the UI
   * has *something* to retrieve even before the ingest pipeline has run.
   *
   * Why: the goal of "npm run dev with no env vars" is that a freelance
   * evaluator can type a question and see a real-looking answer. An
   * empty KB breaks that experience.
   */
  constructor(fixtures?: ReadonlyArray<{ id: string; vector: number[]; metadata: Record<string, unknown> }>) {
    if (fixtures && fixtures.length > 0) {
      const idx = new Map<string, InMemoryRow>();
      for (const row of fixtures) {
        idx.set(row.id, { id: row.id, vector: row.vector, metadata: row.metadata });
      }
      this.indices.set("mastra_docs", idx);
      this.dimensions.set("mastra_docs", fixtures[0]?.vector.length ?? 1024);
      log.info({ count: fixtures.length, index: "mastra_docs" }, "vector.inMemory.seeded");
    }
  }

  async createIndex(indexName: string, dimension: number): Promise<void> {
    if (!this.indices.has(indexName)) {
      this.indices.set(indexName, new Map());
      this.dimensions.set(indexName, dimension);
    }
  }

  async upsert(
    indexName: string,
    rows: ReadonlyArray<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>,
  ): Promise<void> {
    const idx = this.indices.get(indexName);
    if (!idx) {
      throw new Error(`Index ${indexName} does not exist. Call createIndex first.`);
    }
    for (const row of rows) {
      idx.set(row.id, {
        id: row.id,
        vector: row.vector,
        metadata: row.metadata ?? {},
      });
    }
  }

  async query(
    indexName: string,
    queryVector: number[],
    options: { topK?: number; minScore?: number } = {},
  ): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>> {
    const idx = this.indices.get(indexName);
    if (!idx || idx.size === 0) return [];

    const topK = options.topK ?? 10;
    const minScore = options.minScore ?? 0;

    const scored: Array<{ id: string; score: number; metadata: Record<string, unknown> }> = [];
    for (const row of idx.values()) {
      const score = cosineSimilarity(queryVector, row.vector);
      if (score >= minScore) {
        scored.push({ id: row.id, score, metadata: row.metadata });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async reset(indexName: string): Promise<void> {
    this.indices.set(indexName, new Map());
  }

  /** Test helper: count rows in an index. */
  size(indexName: string): number {
    return this.indices.get(indexName)?.size ?? 0;
  }
}

/**
 * Cosine similarity. Both vectors are assumed to be L2-normalized
 * (our embedders produce normalized vectors), so this is equivalent
 * to a dot product — but we keep the explicit form to make the
 * contract obvious to readers.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
