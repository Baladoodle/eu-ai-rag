/**
 * ingestion/embedder.ts
 * ----------------------------------------------------------------------------
 * Wraps Voyage AI for batched embedding of chunked text. The function
 * signature is deliberately identical to what the rest of the codebase
 * expects: `embed(texts) -> vectors`, with one float array per input.
 *
 * Why we need an embedder (educational note for someone new to RAGs):
 *   Retrieval in a RAG system is "given a query, find the most similar
 *   chunks in the KB". To do that, BOTH the query and the chunks
 *   must be turned into the same kind of vector representation. The
 *   embedder's job is to call the embedding model and return those
 *   vectors. The chunker is concerned with WHAT to embed; the
 *   embedder is concerned with HOW to call the API.
 *
 *   We batch because:
 *     1. Voyage accepts up to 128 inputs per request — batching
 *        reduces our round-trip count by 2-3 orders of magnitude.
 *     2. The Voyage SDK is rate-limited per REQUEST, not per token,
 *        so larger batches are pure win.
 *     3. Network parallelism is bounded; we don't want to send 1000
 *        requests in parallel and hit the per-second quota.
 * ----------------------------------------------------------------------------
 */
import { VoyageAIClient } from "voyageai";
import pRetry from "p-retry";

import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import type { ChunkRecord, EmbeddedChunk } from "./types";

/** Voyage AI batch size. Per their docs, max is 128; we stay at 64
 *  to leave headroom for retries and to keep the request body under
 *  a few MB. */
const BATCH_SIZE = 64;

/** Maximum characters per input. Voyage's hard cap is 32K tokens; we
 *  cap at 12K characters to leave plenty of headroom for the tokenizer
 *  (English prose averages 4 chars/token, so 12K chars ≈ 3K tokens). */
const MAX_INPUT_CHARS = 12_000;

/** Lazy singletons. The SDKs do their own connection pooling; we
 *  want to reuse the client across calls in a long ingest run. */
let voyageClient: VoyageAIClient | null = null;

function getVoyage(): VoyageAIClient {
  if (!voyageClient) {
    if (!env.VOYAGE_API_KEY) {
      throw new Error("VOYAGE_API_KEY is required");
    }
    voyageClient = new VoyageAIClient({ apiKey: env.VOYAGE_API_KEY });
  }
  return voyageClient;
}

/**
 * Truncate a chunk's text if it exceeds the model's input limit.
 *
 * Why: a pathologically long line of code or a giant code block
 * could exceed the tokenizer. Better to truncate and add a marker
 * than to 400 the whole batch.
 */
function truncate(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text;
  return text.slice(0, MAX_INPUT_CHARS) + "\n\n[...truncated for embedding...]";
}

/**
 * One call to Voyage. Returns a vector per input, in the same order.
 * Wrapped in p-retry because Voyage occasionally 5xx's during deploys.
 */
async function embedBatchVoyage(texts: string[]): Promise<number[][]> {
  const client = getVoyage();
  return pRetry(
    async () => {
      const res = await client.embed({
        input: texts.map(truncate),
        model: env.EMBEDDING_MODEL as "voyage-law-2" | "voyage-3" | "voyage-code-3",
        inputType: "document",
      });
      if (!res.data || res.data.length !== texts.length) {
        throw new Error(`Voyage returned ${res.data?.length ?? 0} vectors for ${texts.length} inputs`);
      }
      // The SDK returns `embedding` arrays on each data row.
      return res.data.map((row) => row.embedding as unknown as number[]);
    },
    {
      retries: 4,
      minTimeout: 1_000,
      maxTimeout: 20_000,
      factor: 2,
      onFailedAttempt: (err) => {
        log.warn(
          { attempt: err.attemptNumber, remaining: err.retriesLeft, err: err.error?.message ?? String(err.error) },
          "embedder.voyage.retry",
        );
      },
    },
  );
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  return embedBatchVoyage(texts);
}

/**
 * Embed many chunks and return them paired with their vectors.
 *
 * Batching: we slice into BATCH_SIZE groups and process them in
 * sequence (parallelism would just trip the rate limiter).
 */
export async function embedChunks(chunks: ReadonlyArray<ChunkRecord>): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) return [];

  const out: EmbeddedChunk[] = [];
  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const started = Date.now();
    const vectors = await embedBatch(batch.map((c) => c.text));
    const elapsedMs = Date.now() - started;

    for (let j = 0; j < batch.length; j++) {
      const c = batch[j]!;
      const v = vectors[j];
      if (!v) {
        // Should not happen — we asserted on length above — but
        // TypeScript needs the guard.
        log.error({ chunkId: c.id, batch: batchNumber }, "embedder.missingVector");
        continue;
      }
      out.push({
        id: c.id,
        sourceId: c.sourceId,
        text: c.text,
        chunkIndex: c.chunkIndex,
        totalChunks: c.totalChunks,
        vector: v,
        metadata: c.metadata,
      });
    }

    log.debug(
      { batch: batchNumber, of: totalBatches, size: batch.length, elapsedMs, model: env.EMBEDDING_MODEL },
      "embedder.batch",
    );
  }

  log.info(
    { embedded: out.length, batches: totalBatches, model: env.EMBEDDING_MODEL },
    "embedder.done",
  );
  return out;
}
