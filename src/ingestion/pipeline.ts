/**
 * ingestion/pipeline.ts
 * ----------------------------------------------------------------------------
 * The orchestrator that ties scrapers -> chunker -> embedder -> writer
 * together. The CLI (cli.ts) is a thin wrapper that parses flags and
 * calls `runPipeline`.
 *
 * Why an orchestrator (educational note for someone new to RAGs):
 *   A RAG ingest pipeline is a four-stage funnel:
 *
 *      [scrapers]   raw HTML / markdown  ->  RawDocument[]
 *           |
 *      [chunker]    RawDocument[]        ->  ChunkRecord[]
 *           |
 *      [embedder]   ChunkRecord[]        ->  EmbeddedChunk[]
 *           |
 *      [writer]     EmbeddedChunk[]      ->  upserted rows
 *
 *   Each stage is a pure function from input to output (with one
 *   side effect: writing to the vector store). Putting them in one
 *   orchestrator lets us:
 *     1. Track a single source of timing/count metrics.
 *     2. Wire idempotency (the IngestionState) at the right boundary.
 *     3. Provide a stable CLI / API surface so other agents (e.g.
 *        the eval runner) can drive the same pipeline.
 * ----------------------------------------------------------------------------
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";

import cliProgress from "cli-progress";
const SingleBar = (cliProgress as unknown as { SingleBar: new (...args: unknown[]) => cliProgress.SingleBar }).SingleBar;

import { log } from "@/lib/logger";
import { PROCESSED_DIR } from "./scrapers/_shared";
import { scrapeDocs } from "./scrapers/docs";
import { scrapeSource } from "./scrapers/source";
import { scrapeIssues } from "./scrapers/issues";
import { chunkDocuments } from "./chunker";
import { embedChunks } from "./embedder";
import { IngestionState, contentHash } from "./ingestion-state";
import { getVectorWriter, type VectorWriter } from "@/lib/vector-store";
import type { EmbeddedChunk, PipelineResult, RawDocument } from "./types";

/** Options accepted by `runPipeline`. Mirrors the CLI flags 1:1. */
export interface PipelineOptions {
  /** Subset of sources to scrape. Default: all three. */
  source: "all" | "docs" | "source" | "issues";
  /** Limit on the number of items per source. */
  limit?: number;
  /** When true, log the plan but skip the embed + upsert stages. */
  dryRun: boolean;
  /** Override the writer (used in tests). */
  writer?: VectorWriter;
  /** Override the ingestion state (used in tests). */
  state?: IngestionState;
  /** Disable the progress bar (used in tests). */
  silent?: boolean;
}

/**
 * Run the full pipeline. Returns a summary the CLI prints at the end.
 */
export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const started = Date.now();
  const dryRun = opts.dryRun;
  const writer = opts.writer ?? getVectorWriter();
  const state = opts.state ?? (await IngestionState.load());
  const limit = opts.limit;

  // ---------- 1. Scrape ---------------------------------------------------
  log.info({ source: opts.source, limit, dryRun }, "pipeline.start");
  const sources = await selectSources(opts.source);
  const raw: RawDocument[] = [];
  for (const scrape of sources) {
    const docs = await scrape({ limit });
    raw.push(...docs);
  }
  log.info({ scraped: raw.length, source: opts.source }, "pipeline.scraped");

  if (raw.length === 0) {
    log.warn("pipeline.emptyCorpus");
    return {
      sourcesScraped: 0,
      documentsScraped: 0,
      documentsSkipped: 0,
      chunksProduced: 0,
      chunksEmbedded: 0,
      chunksUpserted: 0,
      chunksSkipped: 0,
      totalElapsedMs: Date.now() - started,
      dryRun,
    };
  }

  // ---------- 2. Chunk ----------------------------------------------------
  const chunks = await chunkDocuments(raw);

  // ---------- 3. Idempotency: skip chunks we've already written ----------
  // We compare on content hash, not chunk id, because the chunk id
  // is derived from sourceId+index and the source may have grown
  // (a re-scraped doc has more chunks than the previous version).
  const toEmbed: typeof chunks = [];
  let documentsSkipped = 0;
  for (const c of chunks) {
    if (state.has(c.text)) {
      documentsSkipped++;
    } else {
      toEmbed.push(c);
    }
  }
  log.info(
    { total: chunks.length, toEmbed: toEmbed.length, previouslySeen: documentsSkipped },
    "pipeline.idempotency",
  );

  // ---------- 4. Embed (skip in dry-run) --------------------------------
  let embedded: EmbeddedChunk[] = [];
  if (dryRun) {
    log.warn({ skipped: toEmbed.length }, "pipeline.dryRun.skipEmbed");
  } else {
    embedded = await embedChunks(toEmbed);
  }

  // ---------- 5. Upsert (skip in dry-run) --------------------------------
  const bar = opts.silent
    ? null
    : new SingleBar(
        {
          format: "upserting |{bar}| {percentage}% | {value}/{total} batches",
          hideCursor: true,
        },
        cliProgress.Presets.shades_classic,
      );

  const UPSERT_BATCH = 64;
  let written = 0;
  let skipped = 0;

  if (dryRun) {
    log.warn({ skipped: embedded.length }, "pipeline.dryRun.skipUpsert");
  } else {
    const total = Math.max(1, Math.ceil(embedded.length / UPSERT_BATCH));
    bar?.start(total, 0);
    for (let i = 0; i < embedded.length; i += UPSERT_BATCH) {
      const batch = embedded.slice(i, i + UPSERT_BATCH);
      const summary = await writer.upsert(batch);
      written += summary.written;
      skipped += summary.skipped;
      for (const row of batch) state.markSeen(row.text);
      bar?.update(Math.floor(i / UPSERT_BATCH) + 1);
    }
    bar?.stop();
  }

  // ---------- 6. Persist state -------------------------------------------
  if (!dryRun) {
    await state.save();
  }

  const result: PipelineResult = {
    sourcesScraped: sources.length,
    documentsScraped: raw.length,
    documentsSkipped,
    chunksProduced: chunks.length,
    chunksEmbedded: embedded.length,
    chunksUpserted: written,
    chunksSkipped: skipped,
    totalElapsedMs: Date.now() - started,
    dryRun,
  };

  // ---------- 7. Write a summary file (handy for the eval agent) ---------
  await writeSummary(result, chunks, embedded);

  log.info(result, "pipeline.complete");
  return result;
}

/** Select the scraper(s) matching the `--source` flag. */
function selectSources(source: PipelineOptions["source"]): Array<(opts: { limit?: number }) => Promise<RawDocument[]>> {
  switch (source) {
    case "docs":
      return [scrapeDocs];
    case "source":
      return [scrapeSource];
    case "issues":
      return [scrapeIssues];
    case "all":
    default:
      return [scrapeDocs, scrapeSource, scrapeIssues];
  }
}

/**
 * Write a tiny JSON summary next to the data dir. The eval agent
 * reads this to know what corpus was used for a given run.
 */
async function writeSummary(result: PipelineResult, chunks: ReadonlyArray<{ sourceId: string; text: string }>, embedded: ReadonlyArray<unknown>): Promise<void> {
  const summaryPath = path.join(PROCESSED_DIR, "last-run.json");
  const uniqueSources = new Set(chunks.map((c) => c.sourceId));
  const payload = {
    result,
    uniqueSources: uniqueSources.size,
    sourceIds: [...uniqueSources].sort(),
    sampleContentHash: chunks[0] ? contentHash(chunks[0].text) : null,
    embeddedCount: embedded.length,
    writtenAt: new Date().toISOString(),
  };
  await writeFile(summaryPath, JSON.stringify(payload, null, 2), "utf8");
}
