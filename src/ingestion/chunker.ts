/**
 * ingestion/chunker.ts
 * ----------------------------------------------------------------------------
 * Wraps Mastra's `MDocument.chunk` with our constants and metadata, and
 * returns chunks in the `ChunkRecord` shape used by the rest of the
 * pipeline.
 *
 * Why we need a chunker (educational note for someone new to RAGs):
 *   Embedding models have a hard upper bound on input length — for
 *   voyage-code-3 it's 32K tokens, but in practice, vectors get less
 *   useful as the input gets longer (the model has to "average" more
 *   concepts into one vector). The standard fix is to split each
 *   document into smaller chunks, embed each chunk on its own, and
 *   retrieve at chunk granularity.
 *
 *   The "recursive" strategy we use here splits on the strongest
 *   separator first (e.g. double newline for paragraphs), then the
 *   next-strongest (single newline), then sentences, then characters.
 *   This produces chunks that respect natural document boundaries
 *   much better than a naive fixed-character split.
 *
 *   We also add OVERLAP tokens at the boundaries so a sentence that
 *   happens to span the chunk boundary appears in BOTH chunks. The
 *   alternative (no overlap) means retrieval misses anything that
 *   happens to fall on a boundary. The trade-off is some duplicate
 *   tokens in the KB; for our size, that's worth it.
 * ----------------------------------------------------------------------------
 */
import { createHash } from "node:crypto";
import { MDocument } from "@mastra/rag";

import { log } from "@/lib/logger";
import type { ChunkRecord, RawDocument } from "./types";

/** Target chunk size, in characters. We use character-based sizing
 *  (rather than token-based) because:
 *    - It's deterministic across machines (no tokenizer drift).
 *    - It's good enough for the 1024 default — a typical Mastra doc
 *      page is 50–100KB, and 1024-char chunks give us ~50–100 chunks
 *      per page.
 *  See ARCHITECTURE.md §6 for the rationale on the token-based number
 *  the chunker ends up approximating. */
export const CHUNK_SIZE = 1024;

/** Overlap between adjacent chunks. 128 chars ≈ 12.5% — enough to
 *  catch any sentence that straddles a boundary, not so much that we
 *  pay a large storage tax. */
export const CHUNK_OVERLAP = 128;

/**
 * Build a deterministic id for a chunk.
 *
 * Why: the chunk id is the primary key in the vector store and the
 * document key in the ingestion state file. If we ever changed the
 * hashing scheme we'd silently re-insert every chunk on the next
 * ingest. Determinism is what makes re-runs a no-op.
 *
 * Format: `sha256(sourceId):chunkIndex`, truncated to 16 hex chars
 * for readability. The full sourceId is preserved separately.
 */
export function buildChunkId(sourceId: string, chunkIndex: number): string {
  const h = createHash("sha256").update(`${sourceId}#${chunkIndex}`).digest("hex");
  return `c-${h.slice(0, 16)}-${chunkIndex}`;
}

/**
 * Pick the right Mastra chunk strategy for a given document kind.
 *
 * Why: code (Mastra source) wants different splitting rules than
 * prose. Code blocks are best kept atomic; prose wants paragraph
 * boundaries. Mastra has a `chunkMarkdown` for `.md` and the default
 * `chunkRecursive` handles everything else well.
 */
function pickStrategy(doc: RawDocument): "recursive" | "markdown" {
  if (doc.kind === "source" && doc.url.endsWith(".md")) return "markdown";
  if (doc.kind === "docs") return "markdown";
  if (doc.kind === "issue") return "markdown";
  return "recursive";
}

/**
 * Chunk a single document.
 *
 * Returns an empty array if the document has no usable text. We
 * deliberately don't throw — a single empty document is a degraded
 * KB, not a reason to abort the whole run.
 */
export async function chunkDocument(doc: RawDocument): Promise<ChunkRecord[]> {
  if (!doc.text || doc.text.trim().length === 0) {
    log.warn({ sourceId: doc.sourceId }, "chunker.emptyDocument");
    return [];
  }

  const strategy = pickStrategy(doc);
  const mdoc = MDocument.fromText(doc.text, { sourceId: doc.sourceId });

  // The MDocument API returns a `Document` schema; we re-shape into
  // our own `ChunkRecord`. We use the chunk's `metadata` as a base
  // and merge in our pipeline-level fields.
  let chunks: Array<{ text: string; metadata?: Record<string, unknown> }>;
  try {
    if (strategy === "markdown") {
      await mdoc.chunkMarkdown({ maxSize: CHUNK_SIZE, overlap: CHUNK_OVERLAP });
    } else {
      await mdoc.chunkRecursive({ maxSize: CHUNK_SIZE, overlap: CHUNK_OVERLAP });
    }
    const docs = mdoc.getDocs();
    chunks = docs.map((d) => ({ text: d.text, metadata: d.metadata as Record<string, unknown> | undefined }));
  } catch (err) {
    // Mastra's chunker can fail on pathological input (e.g. an
    // emoji-only string with no boundaries). Fall back to a naive
    // split so we never lose the whole document.
    log.warn({ err: String(err), sourceId: doc.sourceId }, "chunker.fallback");
    chunks = naiveSplit(doc.text);
  }

  if (chunks.length === 0) {
    chunks = naiveSplit(doc.text);
  }

  return chunks.map((c, i) => ({
    id: buildChunkId(doc.sourceId, i),
    sourceId: doc.sourceId,
    text: c.text,
    chunkIndex: i,
    totalChunks: chunks.length,
    metadata: {
      ...doc.metadata,
      ...stripUndef(c.metadata),
      // Preserve the scraper-set kind discriminator ("article" |
      // "recital" | "annex" | "guidance"). `doc.kind` is the
      // ingestion-run kind ("docs" | "source" | "issue"), a coarser
      // bucket; clobbering it here used to make inferSourceLabel in
      // the prompt fall through to the page title because the chunk
      // never carried an article-kind discriminator.
      kind: doc.metadata?.kind ?? doc.kind,
      chunkStrategy: strategy,
      chunkIndex: i,
      totalChunks: chunks.length,
    },
  }));
}

/**
 * Chunk many documents in sequence.
 *
 * Why sequential: chunking is CPU-bound and already fast. Concurrent
 * chunking would just add bookkeeping complexity for no win at our
 * scale (a few hundred documents). Embedding (next stage) is the
 * bottleneck because it hits the network.
 */
export async function chunkDocuments(docs: ReadonlyArray<RawDocument>): Promise<ChunkRecord[]> {
  const out: ChunkRecord[] = [];
  for (const doc of docs) {
    const chunks = await chunkDocument(doc);
    out.push(...chunks);
  }
  log.info({ documents: docs.length, chunks: out.length }, "chunker.done");
  return out;
}

/**
 * Last-resort split: just slice the text on a fixed character boundary.
 * Used when Mastra's chunker throws or returns zero chunks.
 */
function naiveSplit(text: string): Array<{ text: string; metadata?: Record<string, unknown> }> {
  const out: Array<{ text: string; metadata?: Record<string, unknown> }> = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    out.push({ text: text.slice(i, i + CHUNK_SIZE) });
  }
  return out;
}

/**
 * Strip undefined values from a metadata record so we don't put
 * `undefined` into a JSON-serializable metadata column. (The vector
 * store's metadata column is typed; passing `undefined` would 500.)
 */
function stripUndef(obj: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  if (!obj) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return out;
}
