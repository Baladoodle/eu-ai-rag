/**
 * ingestion/scrapers/source.ts
 * ----------------------------------------------------------------------------
 * Scraper for the Annexes (I-XIII) of the EU AI Act.
 *
 * Why this exists (educational note for someone new to RAGs):
 *   Annexes are the structured appendices to Regulation (EU) 2024/1689
 *   and contain lists, criteria, and procedural detail that the Articles
 *   reference. Examples:
 *     - Annex I: the technical AI-system definition checklist
 *     - Annex III: the high-risk use cases (the long list everyone cites)
 *     - Annex IV: the technical documentation requirements for high-risk
 *     - Annex XII: the transparency obligations for deployers
 *
 *   We scrape one Annex per page from the Commission's AI Act Service
 *   Desk (https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-N),
 *   which exposes them in a stable, scrape-friendly layout.
 *
 *   This scraper replaces the former "Mastra GitHub source files" scraper.
 *   The `source` keyword in the CLI flag is kept for backward compatibility
 *   with the pipeline's `--source=source` switch — we just point it at a
 *   different kind of source.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";
import type { RawDocument } from "../types";
import { fetchText, htmlToMarkdown, persistRaw } from "./_shared";

/**
 * The 13 Annexes of the AI Act. Numbered I-XIII in the official text; we
 * use their ordinal position (1..13) for the URL slug.
 */
const ANNEXES: ReadonlyArray<{ ordinal: number; roman: string; title: string }> = [
  { ordinal: 1, roman: "I", title: "Annex I — Union Harmonisation Legislation" },
  { ordinal: 2, roman: "II", title: "Annex II — Information to be Submitted for High-Risk AI System Registration" },
  { ordinal: 3, roman: "III", title: "Annex III — High-Risk AI Systems Referred to in Article 6(3)" },
  { ordinal: 4, roman: "IV", title: "Annex IV — Technical Documentation (High-Risk AI Systems)" },
  { ordinal: 5, roman: "V", title: "Annex V — EU Declaration of Conformity" },
  { ordinal: 6, roman: "VI", title: "Annex VI — Conformity Assessment Procedure (Internal Control)" },
  { ordinal: 7, roman: "VII", title: "Annex VII — Conformity Assessment Based on Assessment of Quality Management System and Assessment of Technical Documentation" },
  { ordinal: 8, roman: "VIII", title: "Annex VIII — Information to be Submitted for Registration of High-Risk AI Systems" },
  { ordinal: 9, roman: "IX", title: "Annex IX — Information to be Submitted for Registration of High-Risk AI Systems Listed in Annex III" },
  { ordinal: 10, roman: "X", title: "Annex X — Union Legislative Acts on Fundamental Rights" },
  { ordinal: 11, roman: "XI", title: "Annex XI — Technical Documentation for GPAI Models (Pre-trained)" },
  { ordinal: 12, roman: "XII", title: "Annex XII — Transparency Information for Deployers" },
  { ordinal: 13, roman: "XIII", title: "Annex XIII — Criteria for Designation of High-Risk AI Systems" },
];

const BASE_URL = "https://ai-act-service-desk.ec.europa.eu/en/ai-act/";
const EUR_LEX_CANONICAL = "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689";

/**
 * Build a stable `sourceId` for an annex, e.g. `ai-act/annex-3`.
 */
function buildSourceId(ordinal: number): string {
  return `ai-act/annex-${ordinal}`;
}

async function scrapeOne(annex: { ordinal: number; roman: string; title: string }): Promise<RawDocument | null> {
  const url = `${BASE_URL}annex-${annex.ordinal}`;
  const sourceId = buildSourceId(annex.ordinal);

  let html: string;
  try {
    html = await fetchText(url);
  } catch (err) {
    log.warn({ sourceId, url, err: String(err) }, "scrape.annex.fetchFailed");
    return null;
  }

  const filename = `annex-${annex.ordinal}.html`;
  await persistRaw("annexes", filename, html);

  const { markdown, title } = htmlToMarkdown(html, url);

  if (markdown.trim().length < 100) {
    log.warn({ sourceId, url, len: markdown.length }, "scrape.annex.empty");
    return null;
  }

  return {
    sourceId,
    url,
    title: title ?? annex.title,
    text: markdown,
    kind: "docs",
    metadata: {
      origin: "ai-act-service-desk.ec.europa.eu",
      canonical: EUR_LEX_CANONICAL,
      annexOrdinal: annex.ordinal,
      annexRoman: annex.roman,
      kind: "annex",
      scrapedAt: new Date().toISOString(),
    },
  };
}

/**
 * Scrape all 13 Annexes. `--limit` caps the count for dev/testing.
 */
export async function scrapeSource(opts: { limit?: number } = {}): Promise<RawDocument[]> {
  const toFetch = opts.limit ? ANNEXES.slice(0, opts.limit) : ANNEXES;
  const out: RawDocument[] = [];

  log.info({ count: toFetch.length }, "scrape.annexes.start");

  for (const annex of toFetch) {
    try {
      const doc = await scrapeOne(annex);
      if (doc) {
        out.push(doc);
        log.info({ sourceId: doc.sourceId, len: doc.text.length }, "scrape.annex.page");
      }
    } catch (err) {
      log.error({ err: String(err), annex: annex.ordinal }, "scrape.annex.failed");
    }
  }

  log.info({ scraped: out.length, attempted: toFetch.length }, "scrape.annexes.done");
  return out;
}
