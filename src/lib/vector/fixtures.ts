/**
 * src/lib/vector/fixtures.ts
 * ----------------------------------------------------------------------------
 * A small, hand-written set of Mastra "documents" used as the seed
 * corpus in dev and in tests when no real embeddings are available.
 *
 * Why this file exists (educational note for someone new to RAGs):
 *   A RAG chatbot with an empty KB is useless. In dev, the user runs
 *   `npm install && npm run dev` long before running the ingest
 *   pipeline. We need a KB that's good enough to demo the chat UX
 *   even when the corpus is empty.
 *
 *   The fixtures are:
 *     1. Real Mastra content (paraphrased from public docs).
 *     2. Hand-written, not scraped (so we don't ship copyrighted text).
 *     3. A handful, not hundreds (the local embedder is a hash function;
 *        quality doesn't scale).
 *
 *   The eval runner also falls back to these fixtures when the live
 *   `/api/chat` is unreachable, so the demo path "just works".
 * ----------------------------------------------------------------------------
 */
import { createHash } from "node:crypto";

/**
 * A single fixture: a synthetic document, with the vector we'll use
 * for it. The vector is produced at module-load time by the same
 * hash-based embedder the runtime uses, so retrieval actually works
 * (same embedding function for the query and the corpus).
 */
export interface FixtureDoc {
  id: string;
  vector: number[];
  metadata: {
    url: string;
    title: string;
    section?: string;
    text: string;
    sourceId: string;
    chunkIndex: number;
    totalChunks: number;
  };
}

const LOCAL_DIM = 256;

/**
 * Hash-based local embedder. Mirrors the one in `lib/rag/embed.ts` —
 * duplicated to avoid a circular import (fixtures load at vector-store
 * init time, which is before rag/embed has a chance to be ready).
 */
function localEmbed(text: string): number[] {
  const vec = new Array<number>(LOCAL_DIM).fill(0);
  const tokens = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2),
  );
  for (const token of tokens) {
    const h = createHash("sha256").update(token).digest();
    for (let b = 0; b < 16; b++) {
      const idx = ((h[b * 2] ?? 0) << 8 | (h[b * 2 + 1] ?? 0)) % LOCAL_DIM;
      const sign = ((h[b + 1] ?? 0) & 1) === 0 ? 1 : -1;
      vec[idx] = (vec[idx] ?? 0) + sign * (((h[b] ?? 0) / 255) + 0.2);
    }
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

/**
 * The fixture corpus. Each entry's `text` is what the LLM will see
 * in the "## Sources" block; the `title` is what the UI shows in
 * the source list.
 *
 * Why we mix docs and code:
 *   A "Mastra expert" should be able to answer both "what is RAG?" and
 *   "how do I call PgVector.query?". The mix is intentional.
 */
const FIXTURE_DOCS: ReadonlyArray<{
  id: string;
  url: string;
  title: string;
  section?: string;
  text: string;
}> = [
  {
    id: "mastra-docs/rag/overview#chunk-0",
    url: "https://mastra.ai/docs/rag/overview",
    title: "Mastra RAG Overview",
    section: "What is RAG",
    text: "Retrieval-Augmented Generation (RAG) is a pattern that grounds LLM responses in retrieved documents. Mastra provides first-class RAG primitives so you can move from a few prototype prompts to a production system without rebuilding the plumbing. The pipeline is: chunk your documents, embed them, store in a vector store, and at query time retrieve the top-K most similar chunks to ground the LLM's response.",
  },
  {
    id: "mastra-docs/rag/vector-databases#chunk-0",
    url: "https://mastra.ai/docs/rag/vector-databases",
    title: "Vector Databases",
    section: "pgvector",
    text: "Mastra ships an adapter for pgvector, the open-source vector store that lives inside Postgres. Using pgvector means you can co-locate vectors with the rest of your application's data and avoid running a second database. The PgVector class implements the same VectorStore interface as the in-memory store, so swapping backends is a one-line change. For local development without Postgres, use the in-memory store: it implements the same interface and runs in-process.",
  },
  {
    id: "mastra-docs/rag/retrieval#chunk-0",
    url: "https://mastra.ai/docs/rag/retrieval",
    title: "Retrieval & Reranking",
    section: "Top-K and rerank",
    text: "Mastra's retrieval step asks the vector store for the top-K most similar chunks (default K=10), then optionally re-ranks them with a cross-encoder model. Rerankers catch cases where pure vector similarity returns a chunk that is lexically similar but semantically off (e.g. an 'installation error' page when the user wanted the 'how to install' page). The MastraAgentRelevanceScorer is the default reranker; CohereReranker is the production-grade alternative.",
  },
  {
    id: "mastra-docs/agents/overview#chunk-0",
    url: "https://mastra.ai/docs/agents/overview",
    title: "Mastra Agents",
    section: "What is an agent",
    text: "A Mastra agent is an LLM bound to a system prompt, a set of tools, and an optional memory backend. Agents are the runtime primitive for tool-using, multi-turn LLM applications. Create one with `new Agent({ name, instructions, model, tools })`. The model field takes any Vercel AI SDK provider; tools are async functions with a Zod input schema.",
  },
  {
    id: "mastra-src/rag/embeddings/index#chunk-0",
    url: "https://github.com/mastra-ai/mastra/blob/main/packages/rag/src/embeddings/index.ts",
    title: "Mastra Embeddings",
    section: "Voyage integration",
    text: "Mastra's RAG module ships an embedMany helper that batches calls to Voyage AI's voyage-code-3 model. The default dimension is 1024 and the input type is 'document' for indexing, 'query' for retrieval. The same model must be used for indexing and querying — mixing them silently breaks similarity. Voyage is recommended over OpenAI for code-heavy corpora (Mastra's docs are 40% code snippets by volume).",
  },
  {
    id: "mastra-src/pg/vector#chunk-0",
    url: "https://github.com/mastra-ai/mastra/blob/main/packages/pg/src/vector.ts",
    title: "PgVector",
    section: "Usage",
    text: "Use the PgVector class from @mastra/pg to connect to a Postgres database with the pgvector extension. Initialize with a connection string: `new PgVector({ connectionString })`. Call `createIndex({ indexName, dimension })` once before upserting vectors; this creates the schema and an HNSW index for fast cosine search. Query with `query({ indexName, vector, topK, filter })` to retrieve the most similar rows.",
  },
  {
    id: "mastra-docs/workflows/overview#chunk-0",
    url: "https://mastra.ai/docs/workflows/overview",
    title: "Workflows",
    section: "What is a workflow",
    text: "A Mastra workflow is a directed graph of steps. Each step is a named, typed function that takes the previous step's output and produces the next step's input. Workflows are durable: each step's result is checkpointed so a long-running workflow can resume from the last successful step after a crash. Use `createWorkflow({ name, steps })` and call `.run({ input })` to execute.",
  },
  {
    id: "mastra-docs/storage/overview#chunk-0",
    url: "https://mastra.ai/docs/storage/overview",
    title: "Storage",
    section: "Memory backends",
    text: "Mastra's storage layer gives agents a memory backend so multi-turn conversations feel coherent. The default backend is Postgres (via the same PgVector connection), with optional LibSQL/SQLite for local dev. Memory is opt-in per agent via the `memory` field on the Agent constructor; without it, every call is stateless.",
  },
  {
    id: "mastra-docs/deployment/overview#chunk-0",
    url: "https://mastra.ai/docs/deployment/overview",
    title: "Deployment",
    section: "Vercel",
    text: "Mastra apps deploy to Vercel in one push. Add ANTHROPIC_API_KEY, VOYAGE_API_KEY, and POSTGRES_CONNECTION_STRING to the Vercel project env, push to main, and the app is live. The recommended Postgres is Supabase (free tier is generous). For self-hosted Postgres, point POSTGRES_CONNECTION_STRING at any pgvector-enabled instance.",
  },
  {
    id: "mastra-docs/integrations/overview#chunk-0",
    url: "https://mastra.ai/docs/integrations/overview",
    title: "Integrations",
    section: "Vector stores supported",
    text: "Mastra ships adapters for pgvector (Postgres), Pinecone, Qdrant, Chroma, and MongoDB Atlas Vector Search. All implement the same VectorStore interface: createIndex, upsert, query. The default for new projects is pgvector; switch backends by swapping the import — no call-site changes needed.",
  },
];

/**
 * Build the fixture corpus: each doc gets a stable id, a vector
 * (via the local embedder), and the metadata the UI displays.
 */
export function buildFixtureCorpus(): FixtureDoc[] {
  return FIXTURE_DOCS.map((doc, i) => ({
    id: doc.id,
    vector: localEmbed(doc.text),
    metadata: {
      url: doc.url,
      title: doc.title,
      ...(doc.section ? { section: doc.section } : {}),
      text: doc.text,
      sourceId: doc.id.split("#")[0] ?? doc.id,
      chunkIndex: i,
      totalChunks: FIXTURE_DOCS.length,
    },
  }));
}
