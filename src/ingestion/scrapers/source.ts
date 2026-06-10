/**
 * ingestion/scrapers/source.ts
 * ----------------------------------------------------------------------------
 * Scraper for the Mastra GitHub source: READMEs, AGENTS.md, and key
 * package source files. We hit the raw.githubusercontent.com URLs
 * directly so we get the raw `.md` or `.ts` content, not an HTML
 * wrapper around it.
 *
 * Why this exists (educational note for someone new to RAGs):
 *   Documentation tells you WHAT a framework does. Source code tells
 *   you HOW — and for developer questions, the exact API signature
 *   ("does the third arg default to true?") is the difference between
 *   a useful and a useless answer.
 *
 *   We deliberately cap the file list to a hand-picked set (see
 *   `data-sources.md` Tier 2) because ingesting the whole repo would
 *   drown the signal in test fixtures, type definitions of unrelated
 *   packages, and the like.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";
import { env } from "@/lib/env";
import type { RawDocument } from "../types";
import { fetchText, persistRaw, slugifyPath } from "./_shared";

/**
 * The hand-picked list of repo paths to ingest. We list both READMEs
 * (high-level, always safe) and a small set of "packages/<name>/src/*.ts"
 * files where the public API surface lives. If you add a file here,
 * add an eval case too — otherwise we have no way to know it helped.
 */
const REPO_PATHS: ReadonlyArray<string> = [
  // Top-level
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  // Package READMEs
  "packages/core/README.md",
  "packages/rag/README.md",
  "packages/pg/README.md",
  "packages/cli/README.md",
  "packages/deployer/README.md",
  // Source files (API surface only)
  "packages/rag/src/index.ts",
  "packages/rag/src/document.ts",
  "packages/rag/src/chunk/index.ts",
  "packages/rag/src/embeddings/index.ts",
  "packages/rag/src/rerank/index.ts",
  "packages/pg/src/vector.ts",
  "packages/pg/src/index.ts",
  "packages/core/src/llm/model/router.ts",
  "packages/core/src/agent/index.ts",
  "packages/core/src/tools/vector-query.ts",
];

/** Size cap. Files larger than this are skipped — we don't want to embed
 *  generated bundles or massive type files. */
const MAX_BYTES = 50_000;

const REPO = "mastra-ai/mastra";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${env.MASTRA_REF}/`;

/**
 * Build a stable `sourceId` from a repo path. We strip the leading
 * `packages/<name>/src/` to keep ids short, but keep the file name
 * so two files with the same name in different packages don't collide.
 */
function buildSourceId(repoPath: string): string {
  const slug = slugifyPath(repoPath).replace(/\.ts$|\.md$/g, "");
  return `mastra-src/${slug}`;
}

/**
 * Heuristic title for a repo file. Prefer the first H1 in markdown
 * (we don't parse the file — too expensive) and fall back to the
 * file basename.
 */
function inferTitle(repoPath: string): string {
  const base = repoPath.split("/").pop() ?? repoPath;
  return base.replace(/\.(ts|md)$/, "");
}

async function scrapeOne(repoPath: string): Promise<RawDocument | null> {
  const url = `${RAW_BASE}${repoPath}`;
  const sourceId = buildSourceId(repoPath);

  const text = await fetchText(url);

  // Apply the size cap AFTER fetching (no HEAD request). If a file
  // grows past 50KB we want a loud log line, not a silent truncation.
  if (text.length > MAX_BYTES) {
    log.warn({ sourceId, len: text.length, max: MAX_BYTES }, "scrape.source.tooLarge");
    return null;
  }

  // Flatten slashes in the filename so we don't create nested
  // directories inside data/raw/source/.
  const safe = (slugifyPath(repoPath) || "root").replace(/\//g, "__");
  const filename = `${safe}.txt`;
  await persistRaw("source", filename, text);

  if (text.trim().length < 50) {
    log.warn({ sourceId, url, len: text.length }, "scrape.source.empty");
    return null;
  }

  return {
    sourceId,
    url,
    title: inferTitle(repoPath),
    text,
    kind: "source",
    metadata: {
      origin: "github.com/mastra-ai/mastra",
      ref: env.MASTRA_REF,
      repoPath,
      scrapedAt: new Date().toISOString(),
    },
  };
}

/**
 * Scrape the curated repo file list. Errors are logged and skipped —
 * the KB is best-effort; a missing file is degraded, not fatal.
 */
export async function scrapeSource(opts: { limit?: number } = {}): Promise<RawDocument[]> {
  const paths = opts.limit ? REPO_PATHS.slice(0, opts.limit) : REPO_PATHS;
  const out: RawDocument[] = [];

  for (const repoPath of paths) {
    try {
      const doc = await scrapeOne(repoPath);
      if (doc) {
        out.push(doc);
        log.info({ sourceId: doc.sourceId, len: doc.text.length }, "scrape.source.file");
      }
    } catch (err) {
      log.error({ err: String(err), repoPath }, "scrape.source.failed");
    }
  }

  log.info({ scraped: out.length, attempted: paths.length }, "scrape.source.done");
  return out;
}
