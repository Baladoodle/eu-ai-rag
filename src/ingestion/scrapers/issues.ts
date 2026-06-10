/**
 * ingestion/scrapers/issues.ts
 * ----------------------------------------------------------------------------
 * Scraper for the European Commission's "Navigating the AI Act" FAQ and
 * related Commission guidance pages.
 *
 * Why this exists (educational note for someone new to RAGs):
 *   Articles and Recitals are the law. Commission FAQ and guidance pages
 *   are the "what does the law mean in practice?" — the kind of question
 *   non-lawyers actually ask. Ingesting them as a separate tier means
 *   retrieval can prefer an Article when the user wants the strict text
 *   and prefer the FAQ when the user wants a plain-language explanation.
 *
 *   We scrape a small, hand-picked list of stable guidance pages
 *   rather than walking the Commission's full document tree:
 *     1. The "Navigating the AI Act" FAQ (one long page of Q&A).
 *     2. Selected "AI Act Service Desk" landing pages (Annex I/II/III
 *        summaries, GPAI obligations summary, compliance checker intro).
 *
 *   This scraper replaces the former "top GitHub issues" scraper. The
 *   `issues` keyword in the CLI flag is kept for backward compatibility
 *   with the pipeline's `--source=issues` switch.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";
import type { RawDocument } from "../types";
import { fetchText, htmlToMarkdown, persistRaw } from "./_shared";

/**
 * Hand-picked guidance pages. URLs must be stable — these are the
 * ones that are linked from the Commission's "AI Act" landing page.
 *
 * Why a short list: most of the Commission's content lives behind the
 * "Documents" library, which is paginated and renumbered. The pages
 * below are the "evergreen" guides that the Commission has committed
 * to keep online and structured.
 */
const GUIDANCE_PAGES: ReadonlyArray<{ url: string; title: string; sourceIdSlug: string }> = [
  {
    url: "https://digital-strategy.ec.europa.eu/en/faqs/navigating-ai-act",
    title: "Commission FAQ — Navigating the AI Act",
    sourceIdSlug: "ec-faq-navigating-ai-act",
  },
  {
    url: "https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai",
    title: "Commission — Regulatory Framework for AI",
    sourceIdSlug: "ec-regulatory-framework",
  },
  {
    url: "https://digital-strategy.ec.europa.eu/en/policies/contents-code-gpai",
    title: "Commission — General-Purpose AI Code of Practice",
    sourceIdSlug: "ec-gpai-code-of-practice",
  },
  {
    url: "https://ai-act-service-desk.ec.europa.eu/en",
    title: "AI Act Service Desk — Home",
    sourceIdSlug: "ec-service-desk-home",
  },
];

const EUR_LEX_CANONICAL = "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689";

function buildSourceId(slug: string): string {
  return `ai-act/${slug}`;
}

async function scrapeOne(page: { url: string; title: string; sourceIdSlug: string }): Promise<RawDocument | null> {
  const sourceId = buildSourceId(page.sourceIdSlug);

  let html: string;
  try {
    html = await fetchText(page.url);
  } catch (err) {
    log.warn({ sourceId, url: page.url, err: String(err) }, "scrape.guidance.fetchFailed");
    return null;
  }

  const filename = `${page.sourceIdSlug}.html`;
  await persistRaw("guidance", filename, html);

  const { markdown, title } = htmlToMarkdown(html, page.url);

  if (markdown.trim().length < 100) {
    log.warn({ sourceId, url: page.url, len: markdown.length }, "scrape.guidance.empty");
    return null;
  }

  return {
    sourceId,
    url: page.url,
    title: title ?? page.title,
    text: markdown,
    kind: "docs",
    metadata: {
      origin: "digital-strategy.ec.europa.eu",
      canonical: EUR_LEX_CANONICAL,
      guidanceSlug: page.sourceIdSlug,
      kind: "guidance",
      scrapedAt: new Date().toISOString(),
    },
  };
}

/**
 * Scrape the curated Commission guidance pages.
 *
 * Why `--limit` here is the page count (default 4): dev convenience.
 */
export async function scrapeIssues(opts: { limit?: number } = {}): Promise<RawDocument[]> {
  const pages = opts.limit ? GUIDANCE_PAGES.slice(0, opts.limit) : GUIDANCE_PAGES;
  const out: RawDocument[] = [];

  log.info({ count: pages.length }, "scrape.guidance.start");

  for (const page of pages) {
    try {
      const doc = await scrapeOne(page);
      if (doc) {
        out.push(doc);
        log.info({ sourceId: doc.sourceId, len: doc.text.length }, "scrape.guidance.page");
      }
    } catch (err) {
      log.error({ err: String(err), page: page.sourceIdSlug }, "scrape.guidance.failed");
    }
  }

  log.info({ scraped: out.length, attempted: pages.length }, "scrape.guidance.done");
  return out;
}
