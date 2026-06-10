/**
 * scripts/ingest.ts
 * ----------------------------------------------------------------------------
 * Thin wrapper that invokes the ingestion CLI. The actual logic lives
 * in `src/ingestion/` (owned by the ingest agent). This file exists
 * so `npm run ingest` has a script in the conventional `scripts/`
 * directory.
 *
 * Why a wrapper (and not the script living in scripts/ directly):
 *   - The pipeline is also driven programmatically (tests, eval
 *     agent, future scheduled jobs). Keeping the CLI logic in
 *     `src/ingestion/cli.ts` and exposing a `main()` function lets
 *     those callers import the same code without spawning a
 *     subprocess.
 * ----------------------------------------------------------------------------
 */
import { main } from "../src/ingestion/cli";

main().then(
  (code) => process.exit(code),
  (err) => {
    // eslint-disable-next-line no-console
    console.error("ingest: unhandled error", err);
    process.exit(1);
  },
);
