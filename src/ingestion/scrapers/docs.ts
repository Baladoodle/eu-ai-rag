/**
 * ingestion/scrapers/docs.ts
 * ----------------------------------------------------------------------------
 * Scraper for the EU AI Act (Regulation (EU) 2024/1689) — the canonical
 * regulation knowledge base.
 *
 * Why this exists (educational note for someone new to RAGs):
 *   The single biggest determinant of retrieval quality is the quality of
 *   the corpus. For a regulation, the corpus is the text of the law itself.
 *   We scrape one Article / Recital / Annex per page so that:
 *     1. Each retrieval chunk maps cleanly to one legal unit.
 *     2. Citation chips in the UI point to a stable, human-readable URL
 *        that the user can open and verify.
 *     3. The chunker is a no-op (the page IS the chunk).
 *
 *   Source: https://artificialintelligenceact.eu — a third-party mirror
 *   that exposes one Article per page at a stable URL pattern
 *   (https://artificialintelligenceact.eu/article/{n}/). EUR-Lex is the
 *   official source, but its HTML is harder to scrape (long, monolithic,
 *   anchor IDs change with OJ versions). The mirror's content is
 *   semantically identical for our purposes; we still cite the EUR-Lex
 *   URL alongside the mirror URL so the user can verify against the
 *   authentic text.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";
import type { RawDocument } from "../types";
import { fetchText, htmlToMarkdown, persistRaw, slugifyPath } from "./_shared";

/**
 * The list of Article numbers we always ingest. We hard-code the list
 * (rather than walking a sitemap) for the same reason the Mastra scraper
 * did: predictable, reproducible runs and no risk of accidentally
 * ingesting commentary pages or draft revisions.
 *
 * Coverage rationale: Articles 1-113 form the operative body of the Act.
 * Annexes I-XIII are pulled by the `annexes` scraper (see source.ts).
 */
const ARTICLE_NUMBERS: ReadonlyArray<number> = [
  // General provisions
  1, 2, 3,
  // Prohibited AI practices
  4, 5,
  // High-risk classification
  6, 7,
  // Requirements for high-risk AI systems
  8, 9, 10, 11, 12, 13, 14, 15,
  // Provider obligations
  16, 17,
  // Transparency and deployer obligations
  18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  // Notified bodies and conformity assessment
  28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
  // Standards, common specifications, presumption of conformity
  48, 49,
  // Transparency obligations for providers and deployers (Article 50)
  50,
  // General-purpose AI (GPAI) rules
  51, 52, 53, 54, 55,
  // Governance
  56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71,
  // Post-market monitoring
  72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94,
  // Confidentiality, penalties, remedies
  95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112,
  // Final provisions
  113,
];

/**
 * Recital numbers we ingest. Recitals give the rationale behind the
 * Articles and are essential for "why does the Act say X?" questions.
 * There are 180 recitals; we ingest all of them.
 */
const RECITAL_NUMBERS: ReadonlyArray<number> = Array.from({ length: 180 }, (_, i) => i + 1);

const BASE_URL = "https://artificialintelligenceact.eu/article/";
const RECITAL_URL = "https://artificialintelligenceact.eu/recital/";
const EUR_LEX_CANONICAL = "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689";

/**
 * Convert an article number into a stable `sourceId` like
 * `ai-act/article-3`. The "ai-act" namespace keeps our source ids
 * disjoint from the previous Mastra ids.
 */
function buildArticleSourceId(articleNumber: number): string {
  return `ai-act/article-${articleNumber}`;
}

function buildRecitalSourceId(recitalNumber: number): string {
  return `ai-act/recital-${recitalNumber}`;
}

/**
 * Heuristic title for an article or recital page. We use the URL slug
 * as a fallback if the HTML doesn't yield a clean `<title>`.
 */
function inferArticleTitle(articleNumber: number): string {
  return `Article ${articleNumber} — EU AI Act`;
}

function inferRecitalTitle(recitalNumber: number): string {
  return `Recital ${recitalNumber} — EU AI Act`;
}

async function scrapeArticle(n: number): Promise<RawDocument | null> {
  const url = `${BASE_URL}${n}/`;
  const sourceId = buildArticleSourceId(n);

  let html: string;
  try {
    html = await fetchText(url);
  } catch (err) {
    // 404s are common for renumbered or reserved articles; log and skip.
    log.warn({ sourceId, url, err: String(err) }, "scrape.article.fetchFailed");
    return null;
  }

  await persistRaw("docs", `article-${n}.html`, html);

  const { markdown, title } = htmlToMarkdown(html, url);

  if (markdown.trim().length < 100) {
    log.warn({ sourceId, url, len: markdown.length }, "scrape.article.empty");
    return null;
  }

  return {
    sourceId,
    url,
    // Prefer the HTML title if extracted; fall back to our heuristic.
    title: title ?? inferArticleTitle(n),
    text: markdown,
    kind: "docs",
    metadata: {
      origin: "artificialintelligenceact.eu",
      canonical: EUR_LEX_CANONICAL,
      articleNumber: n,
      kind: "article",
      scrapedAt: new Date().toISOString(),
    },
  };
}

async function scrapeRecital(n: number): Promise<RawDocument | null> {
  const url = `${RECITAL_URL}${n}/`;
  const sourceId = buildRecitalSourceId(n);

  let html: string;
  try {
    html = await fetchText(url);
  } catch (err) {
    log.warn({ sourceId, url, err: String(err) }, "scrape.recital.fetchFailed");
    return null;
  }

  await persistRaw("docs", `recital-${n}.html`, html);

  const { markdown, title } = htmlToMarkdown(html, url);

  if (markdown.trim().length < 100) {
    log.warn({ sourceId, url, len: markdown.length }, "scrape.recital.empty");
    return null;
  }

  return {
    sourceId,
    url,
    title: title ?? inferRecitalTitle(n),
    text: markdown,
    kind: "docs",
    metadata: {
      origin: "artificialintelligenceact.eu",
      canonical: EUR_LEX_CANONICAL,
      recitalNumber: n,
      kind: "recital",
      scrapedAt: new Date().toISOString(),
    },
  };
}

/**
 * Scrape the curated set of Articles and Recitals.
 *
 * Why we cap by default: the Act has 113 Articles and 180 Recitals = 293
 * pages, all of which we want. `--limit` is a dev convenience for testing
 * the pipeline against a small subset. When `limit` is provided, it
 * applies to the *combined* article + recital count, so `limit=1` means
 * "fetch 1 article (no recitals)" — the same shape as the previous
 * scraper, which read `limit` per-source.
 */
export async function scrapeDocs(opts: { limit?: number } = {}): Promise<RawDocument[]> {
  const limit = opts.limit;
  // If no limit, fetch everything. If a limit is provided, apply it to
  // the combined article+recital count, with articles taking priority.
  const articlesToFetch = limit
    ? ARTICLE_NUMBERS.slice(0, limit)
    : ARTICLE_NUMBERS;
  // Recitals: only fetch if we still have headroom under the limit.
  const recitalsToFetch = limit
    ? RECITAL_NUMBERS.slice(0, Math.max(0, limit - articlesToFetch.length))
    : RECITAL_NUMBERS;

  const out: RawDocument[] = [];

  log.info(
    { articles: articlesToFetch.length, recitals: recitalsToFetch.length },
    "scrape.docs.start",
  );

  for (const n of articlesToFetch) {
    try {
      const doc = await scrapeArticle(n);
      if (doc) {
        out.push(doc);
        log.info({ sourceId: doc.sourceId, len: doc.text.length }, "scrape.docs.article");
      }
    } catch (err) {
      log.error({ err: String(err), article: n }, "scrape.docs.article.failed");
    }
  }

  for (const n of recitalsToFetch) {
    try {
      const doc = await scrapeRecital(n);
      if (doc) {
        out.push(doc);
        log.info({ sourceId: doc.sourceId, len: doc.text.length }, "scrape.docs.recital");
      }
    } catch (err) {
      log.error({ err: String(err), recital: n }, "scrape.docs.recital.failed");
    }
  }

  log.info({ scraped: out.length }, "scrape.docs.done");
  return out;
}

// Re-export slugifyPath so other scrapers that want a similar shape
// don't need to reach into _shared.
export { slugifyPath };
