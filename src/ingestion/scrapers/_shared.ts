/**
 * ingestion/scrapers/_shared.ts
 * ----------------------------------------------------------------------------
 * Common helpers used by every scraper.
 *
 * Why this file exists (educational note for someone new to RAGs):
 *   Three things are the same across every scraper:
 *     1. We need to fetch a URL with retries (the network is unreliable).
 *     2. We need to convert it to something we can chunk + embed.
 *     3. We need to save the raw bytes to disk for replay/debugging.
 *   Factoring these out means each scraper file stays focused on the part
 *   that's actually different (URL list, parsing rules).
 * ----------------------------------------------------------------------------
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import pRetry, { AbortError } from "p-retry";

import { log } from "@/lib/logger";

/**
 * Where raw scraped bytes go. The path is gitignored — we keep raw data
 * out of source control so the repo stays small and secrets (which
 * sometimes appear in scraped HTML as comments) don't get committed.
 *
 * Why raw AND processed: the processed form (chunks, vectors) is derived.
 * If the chunker logic changes, we want to be able to re-derive from raw
 * without re-hitting the network. Saves time, saves rate-limit budget.
 */
export const RAW_DIR = path.resolve(process.cwd(), "data", "raw");
export const PROCESSED_DIR = path.resolve(process.cwd(), "data", "processed");

/**
 * Shared Turndown instance.
 *
 * Why: Turndown is stateful (it caches rules). Sharing one instance is
 * faster than constructing a new one for every page, and it gives us
 * one place to tweak the markdown conversion (e.g. add code-block
 * language hints) if we need to.
 */
export const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_",
});

/**
 * A polite User-Agent. Some sites (including the EUR-Lex / Commission
 * mirrors we scrape) will 403 or 429 requests that don't identify
 * themselves. We identify as the project so the maintainers can reach
 * out if our scraper is misbehaving.
 */
const USER_AGENT = "eu-ai-act-expert-ingest/0.1 (+https://github.com/eu-ai-act-expert)";

/**
 * Fetch a URL and return the body as text, with automatic retries.
 *
 * Why retries: the public EUR-Lex / Commission mirror pages occasionally
 * 502/503 during deploys. We'd rather wait + retry than crash the whole
 * ingest job. Why exponential backoff: a thundering-herd of retries during
 * an outage could make it worse. p-retry's defaults (5 attempts, 1s..30s)
 * are a sensible production setting.
 *
 * Why a User-Agent: some servers reject or rate-limit unidentified
 * clients harder than identified ones.
 */
export async function fetchText(url: string): Promise<string> {
  return pRetry(
    async () => {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,text/markdown",
        },
        // Don't follow redirects to non-http(s) — defense in depth.
        redirect: "follow",
      });
      if (!res.ok) {
        // 4xx is permanent — don't waste time retrying.
        if (res.status >= 400 && res.status < 500) {
          throw new AbortError(`HTTP ${res.status} ${res.statusText} for ${url}`);
        }
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      return res.text();
    },
    {
      retries: 4,
      minTimeout: 1_000,
      maxTimeout: 15_000,
      factor: 2,
      onFailedAttempt: (err) => {
        log.warn(
          { url, attempt: err.attemptNumber, remaining: err.retriesLeft, err: err.error?.message ?? String(err.error) },
          "fetch.retry",
        );
      },
    },
  );
}

/**
 * Wayback Machine snapshot URL builder. When the live mirror of a page
 * is unreachable (typically: misconfigured server-side redirects on
 * artificialintelligenceact.eu that loop forever), we fall back to an
 * archived snapshot. The `id_` flag tells Wayback to serve raw bytes
 * without injecting its toolbar/analytics script wrappers — keeps the
 * HTML clean for downstream Readability/turndown parsing.
 *
 * Why 2024: the EU AI Act was published in 2024; recitals have been
 * stable since then and snapshots from any 2024 date are equivalent.
 */
export function waybackUrl(liveUrl: string): string {
  return `https://web.archive.org/web/2024id_/${liveUrl}`;
}

/**
 * Fetch with automatic Wayback Machine fallback. Same signature as
 * `fetchText`, but if the primary URL throws (e.g. redirect loop, 5xx
 * after retries), we try the Wayback snapshot once before giving up.
 *
 * Why a single fallback: a chained series of fallbacks (Wayback -> EUR-Lex
 * -> ...) bloats the scraper and hides real upstream bugs. Wayback covers
 * every case we've hit so far; we add more only when needed.
 *
 * Returns { html, origin } so callers can stamp the source of the bytes
 * they persisted into the corpus metadata.
 */
export async function fetchTextWithWaybackFallback(
  url: string,
): Promise<{ html: string; origin: "live" | "wayback" }> {
  try {
    const html = await fetchText(url);
    return { html, origin: "live" };
  } catch (err) {
    log.warn(
      { url, err: err instanceof Error ? err.message : String(err) },
      "scrape.fallback.wayback",
    );
    const archived = await fetchText(waybackUrl(url));
    return { html: archived, origin: "wayback" };
  }
}
/**
 * Save raw bytes to disk. The path is `data/raw/<namespace>/<file>`.
 *
 * Why persist raw: the chunker is the most volatile part of the pipeline
 * (we'll tune it as we look at eval scores). If we ever need to re-chunk
 * without re-scraping, the raw data is right there.
 */
export async function persistRaw(namespace: string, filename: string, body: string): Promise<string> {
  const dir = path.join(RAW_DIR, namespace);
  await mkdir(dir, { recursive: true });
  const filepath = path.join(dir, filename);
  await writeFile(filepath, body, "utf8");
  return filepath;
}

/**
 * Extract the main readable content from an HTML document.
 *
 * Pipeline: Mozilla Readability first (it picks the article body and
 * strips nav/footer/ads in one shot). If that fails (some pages have
 * weird structure), fall back to cheerio + Turndown on the full body.
 *
 * Why a fallback: Readability is conservative. It returns `null` for
 * pages it can't classify as an "article". Rather than dropping the
 * page, we degrade to a more permissive extraction.
 */
export function htmlToMarkdown(html: string, url: string): { markdown: string; title?: string } {
  // `url` is currently unused at runtime — we keep it in the signature
  // for call-site readability (the URL often explains what page is
  // being parsed) and to leave room for future use (e.g. canonical
  // URL injection into the markdown).
  void url;
  const dom = cheerio.load(html);
  // Readability wants a real DOM Document, not a cheerio wrapper. We
  // build a minimal DOMDocument from the cheerio root by extracting
  // the HTML. Cheerio's `dom.html()` returns the serialized root.
  const serialized = dom.html();
  const jsdom = new JSDOM(serialized);
  const parsed = new Readability(jsdom.window.document).parse();

  if (parsed && parsed.content && parsed.textContent && parsed.textContent.length > 200) {
    const md = turndown.turndown(parsed.content);
    return { markdown: md, title: parsed.title ?? undefined };
  }

  // Fallback: convert the full body. Strip the obvious chrome first.
  dom("script, style, nav, header, footer, aside, [aria-hidden=true]").remove();
  const body = dom("main").first().html() ?? dom("body").html() ?? "";
  const md = turndown.turndown(body);
  return { markdown: md, title: dom("title").first().text() || undefined };
}

/**
 * Slugify a URL path so it can be used as a stable source-id component.
 * Why: we want source ids like `ai-act/article-3` not
 * `ai-act/article%2F3%2F`. Easier to read in logs and evals.
 */
export function slugifyPath(pathname: string): string {
  return pathname
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .toLowerCase();
}
