/**
 * src/backend/rag/citations.ts
 * ----------------------------------------------------------------------------
 * Step 3 of the RAG pipeline (sidecar to retrieval + generation):
 * turn raw retrieved chunks into UI-ready `Source` objects and
 * `Citation` markers.
 *
 * What "citations" means in this app (educational):
 *   A citation is the *bridge* between the LLM's generated text and
 *   the chunks we fed it. There are two halves:
 *     1. The LLM emits markers like `[1]`, `[2]` inline in its answer.
 *     2. The UI renders those markers as clickable chips. Clicking a
 *        chip scrolls to the matching `Source` in the right-hand panel.
 *   This file is responsible for *both* halves: it produces the
 *   `Source` list the UI renders, and it provides the regex the
 *   frontend can use to detect citation markers in the streamed text.
 *
 * Why we extract citations as a separate step:
 *   - The retrieval layer doesn't know about the UI's `Source` shape
 *     and shouldn't (separation of concerns).
 *   - The generation layer just streams text; it doesn't know which
 *     chunks were retrieved.
 *   - Citations are a UI concern that can change (different marker
 *     format, different fields) without touching the rest of the
 *     pipeline.
 *
 * Why a `Source` is a separate type from `RetrievedChunk`:
 *   - `RetrievedChunk` is what comes *out of the vector store* —
 *     minimal, no UI concerns.
 *   - `Source` is what the *UI renders* — has a title, a URL, a
 *     snippet, an ISO timestamp. Different lifecycles, different
 *     responsibilities.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";
import type { RetrievedChunk } from "@/lib/vector-store-reader";
import {
  asSourceId,
  type Citation,
  type Source,
} from "../../../api-contract";
import { makeSnippet } from "./prompt";

/**
 * The shape of metadata we expect on each chunk. The ingestion agent
 * stores this; we just read it.
 *
 * Why a structural type (vs. a class):
 *   Lets us read whatever fields the corpus happens to have without
 *   coupling to the writer's schema module.
 */
interface ChunkMetadata {
  /** Canonical URL of the source page. */
  url?: string;
  /** Human-readable title for the source panel. */
  title?: string;
  /** Optional H2/H3 heading within the page. */
  section?: string;
}

/**
 * Build the UI's `Source` list from retrieved chunks.
 *
 * Why we pair this with retrieval metadata:
 *   The Source list is what the UI shows *in addition* to the answer.
 *   We want it to be stable across the lifetime of a request — even
 *   if the LLM hallucinates, the source list is ground truth (it
 *   came from the vector store, not from the model).
 */
export function buildSources(
  chunks: ReadonlyArray<RetrievedChunk>,
  options: { embeddingModel: string; now?: () => Date } = { embeddingModel: "voyage-code-3" },
): Source[] {
  const now = options.now ?? (() => new Date());
  return chunks.map((chunk, index) => chunkToSource(chunk, index, now()));
}

/**
 * Convert one chunk to a `Source` with stable id, snippet, and timestamp.
 *
 * Why we synthesize the id as `id#n`:
 *   The chunk id from the vector store is `namespace/slug#chunkIndex`.
 *   Appending the position-in-the-list (`#n`) gives us a unique key
 *   for React rendering *and* a way for the UI to deep-link to a
 *   specific citation chip in the answer.
 */
function chunkToSource(chunk: RetrievedChunk, index: number, when: Date): Source {
  const meta = chunk.metadata as ChunkMetadata | undefined;
  return {
    id: asSourceId(`${chunk.id}#${index + 1}`),
    title: meta?.title ?? "Untitled source",
    url: meta?.url ?? "",
    ...(meta?.section ? { section: meta.section } : {}),
    snippet: makeSnippet(chunk.text),
    fullText: chunk.text,
    score: chunk.score,
    retrievedAt: when.toISOString(),
  };
}

/**
 * Build the `Citation` array (one Citation per Source) that the UI
 * consumes as the `data-sources` part of the message stream.
 *
 * Why a separate function from `buildSources`:
 *   - Tests want to assert on the citation indices independently of
 *     the source list.
 *   - The UI's API contract distinguishes between a `Source` (the
 *     data) and a `Citation` (the *numbered reference* in the text).
 *     `Citation` adds the `index` field that links to `[n]` markers.
 */
export function buildCitations(
  chunks: ReadonlyArray<RetrievedChunk>,
  options: { embeddingModel: string; now?: () => Date } = { embeddingModel: "voyage-code-3" },
): Citation[] {
  const sources = buildSources(chunks, options);
  return sources.map((source, idx) => ({
    index: idx + 1,
    source,
  }));
}

/**
 * The regex the frontend uses to find `[1]`, `[2]`, ... in the streamed
 * text. We expose it as a string so the client can compile it once and
 * cache the resulting `RegExp`.
 *
 * Why we limit to 1..99:
 *   In practice we never have more than ~10 sources, so anything beyond
 *   `99` is almost certainly a different kind of bracketed text (a
 *   footnote in a code comment, a year in a date, etc.). Capping the
 *   regex avoids false positives without losing real citations.
 */
export const CITATION_MARKER_REGEX_SOURCE = "\\[(\\d{1,2})\\]";

/**
 * Convenience constructor: returns a `RegExp` with the `g` flag for
 * scanning the whole text.
 */
export function citationMarkerRegex(): RegExp {
  return new RegExp(CITATION_MARKER_REGEX_SOURCE, "g");
}

/**
 * Given a chunk of assistant text, return the set of citation indices
 * the model emitted. The frontend uses this to highlight which chips
 * are "actually referenced" in the answer.
 *
 * Why we extract on the server:
 *   - The server is the source of truth for what sources were
 *     retrieved; the client shouldn't try to infer "which sources
 *     were used" from the text alone.
 *   - We can include this in the `data-sources` part so the UI gets
 *     it in one round trip.
 */
export function extractCitationIndices(assistantText: string): number[] {
  const indices = new Set<number>();
  const regex = citationMarkerRegex();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(assistantText)) !== null) {
    // The capture group is the number inside the brackets.
    const n = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(n) && n > 0) {
      indices.add(n);
    }
  }
  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Truncate a snippet for display.
 *
 * Why this lives here and not in the UI:
 *   The snippet length is a server-side policy (we want a single
 *   answer about "how much text" the UI should show). The UI just
 *   trusts whatever we send.
 *
 * Re-exported from prompt.ts for convenience; callers shouldn't have
 * to import from two places.
 */
export { makeSnippet };

/**
 * Diagnostic helper: count the citations in a piece of text.
 *
 * Why:
 *   Evals use this to compute "groundedness" — an answer that emits
 *   zero citations is almost always a refusal, and an answer that
 *   emits N citations per claim is a stronger signal than one that
 *   emits them only at the end.
 */
export function countCitations(assistantText: string): number {
  return extractCitationIndices(assistantText).length;
}

/**
 * Strip citation markers from the assistant text — useful for the
 * eval scorer, which wants to check the prose without the `[n]`
 * noise confusing its substring matchers.
 */
export function stripCitationMarkers(assistantText: string): string {
  return assistantText.replace(citationMarkerRegex(), "").replace(/\s+/g, " ").trim();
}

/**
 * Log a summary of the citations we're about to ship to the client.
 * Helps the eval/observability story without leaking chunk text into logs.
 */
export function logCitationSummary(citations: ReadonlyArray<Citation>): void {
  log.info(
    {
      count: citations.length,
      topScore: citations[0]?.source.score ?? 0,
    },
    "citations.built",
  );
}
