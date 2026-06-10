#!/usr/bin/env tsx
/**
 * ingestion/cli.ts
 * ----------------------------------------------------------------------------
 * The CLI entry point. Wires `npm run ingest` -> `runPipeline`.
 *
 * Why a separate file (educational note for someone new to RAGs):
 *   The pipeline is a library; the CLI is a thin adapter that
 *   translates argv + env into a PipelineOptions object. Keeping
 *   them separate means:
 *     - The pipeline can be driven from other tools (e.g. an eval
 *       runner) without going through argv parsing.
 *     - The CLI can be tested with mocked argv, no harness needed.
 *     - A future web UI / scheduled job can call runPipeline()
 *       directly.
 *
 *   We export `main()` so the e2e tests can invoke the CLI in-process
 *   and assert on the result.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";
import { env } from "@/lib/env";
import { runPipeline, type PipelineOptions } from "./pipeline";

/**
 * Parse argv into a PipelineOptions. Exported for tests.
 *
 * Supported flags:
 *   --dry-run             : scrape + chunk, skip embed and upsert
 *   --source=<docs|source|issues|all>  : which subset to ingest
 *   --limit=<n>           : per-source cap (handy for dev)
 *   --help                : print usage and exit
 */
export function parseArgs(argv: ReadonlyArray<string>): PipelineOptions & { help?: boolean } {
  const opts: PipelineOptions & { help?: boolean } = {
    source: "all",
    dryRun: env.DRY_RUN === "1",
  };

  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg.startsWith("--source=")) {
      const v = arg.slice("--source=".length);
      if (v === "docs" || v === "source" || v === "issues" || v === "all") {
        opts.source = v;
      } else {
        throw new Error(`Invalid --source value: ${v}`);
      }
    } else if (arg.startsWith("--limit=")) {
      const n = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --limit value: ${arg}`);
      opts.limit = n;
    } else {
      // Be loud about unknown flags — silent acceptance is a foot-gun.
      log.warn({ arg }, "cli.unknownFlag");
    }
  }
  return opts;
}

const HELP = `
mastra-expert ingest CLI

Usage:
  tsx src/ingestion/cli.ts [options]

Options:
  --source=<docs|source|issues|all>   Which subset to ingest (default: all)
  --limit=<n>                         Per-source cap on items (default: no cap)
  --dry-run                           Scrape + chunk only, skip embed + upsert
  --help, -h                          Show this help

Environment variables (see .env.example):
  VOYAGE_API_KEY            Required for embedding (unless --dry-run).
  OPENAI_API_KEY            Fallback if EMBEDDING_PROVIDER=openai.
  EMBEDDING_PROVIDER        "voyage" (default) or "openai".
  EMBEDDING_MODEL           "voyage-code-3" (default) | "voyage-3" | "text-embedding-3-small".
  POSTGRES_CONNECTION_STRING  Required when VECTOR_BACKEND=pg.
  VECTOR_BACKEND            "pg" (default in prod) | "memory" (default in dev).
  MASTRA_REF                Git ref for the source scraper (default: main).
  INGEST_LIMIT              Numeric cap on items per source.
  DRY_RUN                   Set to "1" to default --dry-run.
`.trim();

/**
 * Main entry. Exported so the e2e agent can call it directly.
 */
export async function main(argv: ReadonlyArray<string> = process.argv.slice(2)): Promise<number> {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    log.error({ err: String(err) }, "cli.parseFailed");
    console.error(HELP);
    return 2;
  }

  if (opts.help) {
    console.log(HELP);
    return 0;
  }

  log.info({ opts }, "cli.start");

  try {
    const result = await runPipeline({
      source: opts.source,
      limit: opts.limit,
      dryRun: opts.dryRun,
    });

    // Always print a final summary to stdout — operators eyeball this.
    console.log(
      "\n=== Ingest summary ===\n" +
        `  source:         ${opts.source}\n` +
        `  dry-run:        ${result.dryRun}\n` +
        `  documents:      ${result.documentsScraped}\n` +
        `  chunks:         ${result.chunksProduced}\n` +
        `  embedded:       ${result.chunksEmbedded}\n` +
        `  upserted:       ${result.chunksUpserted}\n` +
        `  skipped (seen): ${result.chunksSkipped}\n` +
        `  total time:     ${(result.totalElapsedMs / 1000).toFixed(1)}s\n`,
    );

    return 0;
  } catch (err) {
    log.error({ err: String(err) }, "cli.failed");
    return 1;
  }
}

// Run when invoked directly. We use `import.meta.url` instead of
// `require.main === module` because this is an ESM-style .ts file.
import { fileURLToPath } from "node:url";
const isMain = typeof process !== "undefined" && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      log.error({ err: String(err) }, "cli.unhandled");
      process.exit(1);
    },
  );
}
