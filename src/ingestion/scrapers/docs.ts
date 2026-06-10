/**
 * ingestion/scrapers/docs.ts
 * ----------------------------------------------------------------------------
 * Scraper for https://mastra.ai/docs/* — the canonical Mastra knowledge.
 *
 * Why this exists (educational note for someone new to RAGs):
 *   The single biggest determinant of retrieval quality is the quality of
 *   the corpus. Documentation pages are the highest-signal source for a
 *   "Mastra expert" chatbot: they explain concepts, contain code samples,
 *   and are written by the people who built the framework.
 *
 *   This scraper:
 *     1. Walks a curated seed list of the highest-priority doc pages.
 *     2. Fetches the HTML for each.
 *     3. Extracts the readable content (Readability + Turndown).
 *     4. Returns a list of `RawDocument`s for the chunker to consume.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";
import type { RawDocument } from "../types";
import {
  fetchText,
  htmlToMarkdown,
  persistRaw,
  slugifyPath,
} from "./_shared";

/**
 * The Tier-1 doc pages we always ingest. See `data-sources.md` for the
 * "why" behind each one. We hard-code the list rather than crawling
 * mastra.ai/docsitemap.xml because:
 *   - The sitemap isn't always available.
 *   - We want predictable, reproducible runs.
 *   - We don't want to accidentally ingest draft/internal pages.
 */
const DOC_SEEDS: ReadonlyArray<{ path: string; title: string }> = [
  { path: "", title: "Mastra Documentation (landing)" },
  { path: "rag/overview", title: "RAG Overview" },
  { path: "rag/vector-databases", title: "Vector Databases" },
  { path: "rag/retrieval", title: "Retrieval" },
  { path: "agents/overview", title: "Agents Overview" },
  { path: "workflows/overview", title: "Workflows Overview" },
  { path: "storage/overview", title: "Storage Overview" },
  { path: "deployment/overview", title: "Deployment Overview" },
  { path: "integrations/overview", title: "Integrations Overview" },
  { path: "observability/overview", title: "Observability Overview" },
  { path: "voice/overview", title: "Voice Overview" },
];

const BASE_URL = "https://mastra.ai/docs/";

/**
 * Convert one doc path into a stable `sourceId` like `mastra-docs/rag/overview`.
 *
 * The landing page (empty path) gets the special id `mastra-docs/landing`
 * so the eval set has a single, predictable name to reference.
 */
function buildSourceId(pathname: string): string {
  const slug = slugifyPath(pathname);
  return slug ? `mastra-docs/${slug}` : "mastra-docs/landing";
}

/**
 * Scrape a single page. Returns null if the page is empty (we'd rather
 * skip than upsert a useless empty row).
 */
async function scrapeOne(seed: { path: string; title: string }): Promise<RawDocument | null> {
  const url = `${BASE_URL}${seed.path}`;
  const sourceId = buildSourceId(seed.path);

  const html = await fetchText(url);
  // Flatten slashes in the filename so we don't create nested
  // directories inside data/raw/docs/. We replace / with __ for
  // readability (e.g. "rag__overview.html" instead of "rag-overview.html").
  const safe = (slugifyPath(seed.path) || "landing").replace(/\//g, "__");
  const filename = `${safe}.html`;
  await persistRaw("docs", filename, html);

  const { markdown, title } = htmlToMarkdown(html, url);

  // Why a length floor: a doc page that yields < 100 chars of markdown
  // is almost certainly a JS-only page that didn't render server-side.
  // Skipping it is better than polluting the KB with empty chunks.
  if (markdown.trim().length < 100) {
    log.warn({ sourceId, url, len: markdown.length }, "scrape.empty");
    return null;
  }

  return {
    sourceId,
    url,
    title: title ?? seed.title,
    text: markdown,
    kind: "docs",
    metadata: {
      origin: "mastra.ai/docs",
      seedPath: seed.path,
      scrapedAt: new Date().toISOString(),
    },
  };
}

/**
 * Scrape the curated doc set. Stops on the first hard failure (a 4xx)
 * but logs and continues on transient (5xx, network) errors.
 */
export async function scrapeDocs(opts: { limit?: number } = {}): Promise<RawDocument[]> {
  const seeds = opts.limit ? DOC_SEEDS.slice(0, opts.limit) : DOC_SEEDS;
  const out: RawDocument[] = [];

  for (const seed of seeds) {
    try {
      const doc = await scrapeOne(seed);
      if (doc) {
        out.push(doc);
        log.info({ sourceId: doc.sourceId, len: doc.text.length }, "scrape.docs.page");
      }
    } catch (err) {
      // p-retry already retried. If we're here it's a hard failure.
      // Log and continue: a missing page is a degraded KB, not a
      // reason to abort the whole ingest.
      log.error({ err: String(err), seed: seed.path }, "scrape.docs.failed");
    }
  }

  log.info({ scraped: out.length, attempted: seeds.length }, "scrape.docs.done");
  return out;
}
