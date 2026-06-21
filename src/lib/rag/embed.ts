/**
 * src/lib/rag/embed.ts
 * ----------------------------------------------------------------------------
 * Embedding adapter. The single place that knows how to turn text into
 * vectors. Production uses Voyage AI (with OpenAI as a documented fallback);
 * local dev with no API keys uses a deterministic, hash-based embedder so
 * the full RAG pipeline still works end-to-end.
 *
 * Why this file is the one place that knows about Voyage (educational):
 *   The rest of the codebase cares about *vectors*, not *where they came
 *   from*. Centralizing the Voyage call here means:
 *     - We can swap providers with a one-line change.
 *     - The retrieval code never imports voyageai directly.
 *     - Tests can mock this module and get deterministic vectors.
 *
 * Why we have a "local" embedder:
 *   `npm install && npm run dev` must work with zero env vars. We fall
 *   back to a hash-based embedder that produces a fixed-dimension vector
 *   per input. Quality is degraded (no semantic similarity) but the
 *   pipeline runs end-to-end and the dev experience is positive.
 * ----------------------------------------------------------------------------
 */
import { createHash } from "node:crypto";

import { env } from "@/lib/env";
import { log } from "@/lib/logger";

/**
 * The dimension of the local (hash-based) embedder. Why 256:
 *   - Power of 2 (works for typical SIMD widths).
 *   - Big enough to produce meaningful cosine-similarity spread.
 *   - Small enough that the JSON state file stays small.
 * Production embeddings come from voyage-code-3 at dimension 1024; we
 * keep the local one separate so a dev run doesn't get mistaken for
 * production data.
 */
const LOCAL_EMBED_DIM = 256;

/**
 * The local, deterministic embedder. Used when no Voyage/OpenAI key is
 * present (i.e. the "works without API keys" dev story).
 *
 * How it works: tokenize the text (lowercased words), hash each token,
 * and add the token's hash-derived slice into the vector. This gives
 * a *bag-of-words* style embedding: two texts that share many tokens
 * produce similar vectors, even without a real model.
 *
 * Why not a real local model:
 *   - Adds a dependency and a download step.
 *   - The whole point of the local embedder is that "it just works".
 *   - We only need *some* vector; semantic quality is degraded but
 *     enough to demo the chat UX.
 */
function localEmbed(texts: string[]): Promise<number[][]> {
  return Promise.resolve(
    texts.map((t) => hashToVector(t, LOCAL_EMBED_DIM)),
  );
}

/**
 * Tokenize + hash a string into a fixed-dimension unit vector.
 * The vector is L2-normalized so cosine similarity reduces to a
 * dot product. The tokenizer is intentionally trivial: lowercase,
 * split on non-alphanumeric, dedupe.
 */
function hashToVector(text: string, dim: number): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2),
  );
  for (const token of tokens) {
    const h = createHash("sha256").update(token).digest();
    // 16 dims per token -> up to 64 dims touched per unique token.
    for (let b = 0; b < 16; b++) {
      const idx = ((h[b * 2] ?? 0) << 8 | (h[b * 2 + 1] ?? 0)) % dim;
      const sign = ((h[b + 1] ?? 0) & 1) === 0 ? 1 : -1;
      vec[idx] = (vec[idx] ?? 0) + sign * (((h[b] ?? 0) / 255) + 0.2);
    }
  }
  // L2 normalize.
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Lazily-constructed Voyage client. Why lazy: avoids loading the SDK
 * (and validating the API key) at module-import time so a dev who
 * never calls `embed()` doesn't need a key.
 */
let voyageClient: import("voyageai").VoyageAIClient | null = null;
async function getVoyageClient(): Promise<import("voyageai").VoyageAIClient> {
  if (voyageClient) return voyageClient;
  if (!env.VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY is required when EMBEDDING_PROVIDER=voyage");
  }
  const { VoyageAIClient } = await import("voyageai");
  voyageClient = new VoyageAIClient({ apiKey: env.VOYAGE_API_KEY });
  return voyageClient;
}

/**
 * Voyage embed. One batch per call. We don't batch here — callers
 * (the ingestion pipeline) slice into 64-doc batches and call us
 */
async function voyageEmbed(texts: string[]): Promise<number[][]> {
  const client = await getVoyageClient();
  const res = await client.embed({
    input: texts,
    model: (env.EMBEDDING_MODEL as "voyage-law-2" | "voyage-3" | "voyage-code-3") ?? "voyage-law-2",
    inputType: "document",
  });
  if (!res.data || res.data.length !== texts.length) {
    throw new Error(
      `Voyage returned ${res.data?.length ?? 0} vectors for ${texts.length} inputs`,
    );
  }
  return res.data.map((row) => row.embedding as unknown as number[]);
}

/**
 * Local-mode guard. True when the user has no API keys AND the env
 * doesn't force a provider.
 */
function shouldUseLocalEmbedder(): boolean {
  if (env.EMBEDDING_PROVIDER === "voyage" && !env.VOYAGE_API_KEY) return true;
  if (env.EMBEDDING_PROVIDER === "openai" && !env.OPENAI_API_KEY) return true;
  return false;
}

/**
 * Embed a batch of texts. Returns one vector per input, in the same order.
 *
 * This is the ONLY function the rest of the codebase calls. Provider
 * selection happens here, not at the call site.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (shouldUseLocalEmbedder()) {
    log.debug(
      { count: texts.length, dim: LOCAL_EMBED_DIM },
      "embed.local.fallback",
    );
    return localEmbed(texts);
  }

  // Voyage is the default; OpenAI is wired in env.ts but not implemented
  // here in v1 to avoid pulling in another SDK. (Ingestion has OpenAI;
  // the runtime path uses Voyage.)
  return voyageEmbed(texts);
}

/**
 * The expected dimension of vectors produced by `embed()`. Used by the
 * vector store to size its index. Local and voyage dimensions differ,
 * so we read it at runtime.
 */
export const LOCAL_DIMENSION = LOCAL_EMBED_DIM;
export const VOYAGE_DIMENSION = 1024;

/**
 * Public helper: which dimension is the current `embed()` function
 * going to return? The vector store calls this to size its index.
 */
export function activeEmbeddingDimension(): number {
  return shouldUseLocalEmbedder() ? LOCAL_DIMENSION : VOYAGE_DIMENSION;
}
