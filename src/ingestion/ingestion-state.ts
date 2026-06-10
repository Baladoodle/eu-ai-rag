/**
 * ingestion/ingestion-state.ts
 * ----------------------------------------------------------------------------
 * Idempotency tracker for the ingest pipeline. We persist a small
 * JSON file that records (a) the content hash of every chunk we've
 * ever upserted, and (b) the timestamp of the last successful run.
 *
 * Why this file exists (educational note for someone new to RAGs):
 *   A RAG ingest pipeline runs regularly (weekly, on every CI build,
 *   whenever docs change). The naive thing to do is "always upsert
 *   everything" — but that's slow, expensive (you pay for embeddings
 *   every time), and noisy (every embed call is a chance to fail).
 *
 *   The professional approach is IDEMPOTENT ingest: re-running the
 *   pipeline is a no-op when nothing has changed. To make that
 *   possible, we need to remember WHAT we already wrote. We do that
 *   with a content hash:
 *     - The chunk's text is hashed (sha256).
 *     - The hash is the chunk's "idempotency key".
 *     - On re-run, we look up the key: if we've seen this exact text
 *       before, we skip the embed and the upsert entirely.
 *
 *   We persist the seen-set to disk so that an interrupted run can
 *   pick up where it left off, and so that the in-memory state can
 *   be rebuilt without network calls.
 * ----------------------------------------------------------------------------
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { log } from "@/lib/logger";

const STATE_DIR = path.resolve(process.cwd(), "data", "processed");
const STATE_FILE = path.join(STATE_DIR, "ingestion-state.json");

/**
 * Persisted shape. Versioned so a future schema change can be handled
 * without crashing old binaries.
 */
export interface IngestionStateFile {
  /** Schema version. Bump when changing the shape. */
  version: 1;
  /** When the state file was last written. */
  updatedAt: string;
  /** Map of contentHash -> first-seen ISO timestamp. */
  seenChunks: Record<string, string>;
}

/**
 * Compute the content hash of a chunk. We use the chunk's text only,
 * NOT the metadata, because metadata is derived from the source (and
 * we may legitimately re-ingest a source that has had a label added).
 *
 * Why sha256 (not md5, not murmur): sha256 is in the Node stdlib, has
 * negligible collision probability for our scale, and the output is
 * a stable 64-char hex string we can use as a primary key.
 */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** In-memory + on-disk wrapper. */
export class IngestionState {
  private file: IngestionStateFile;
  private dirty = false;

  private constructor(file: IngestionStateFile) {
    this.file = file;
  }

  /** Load from disk (or initialize a new empty state). */
  static async load(): Promise<IngestionState> {
    await mkdir(STATE_DIR, { recursive: true });
    if (!existsSync(STATE_FILE)) {
      return new IngestionState({ version: 1, updatedAt: new Date().toISOString(), seenChunks: {} });
    }
    try {
      const raw = await readFile(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw) as IngestionStateFile;
      if (parsed.version !== 1) {
        log.warn({ version: parsed.version }, "ingestionState.schemaMismatch");
        return new IngestionState({ version: 1, updatedAt: new Date().toISOString(), seenChunks: {} });
      }
      return new IngestionState(parsed);
    } catch (err) {
      // Corrupt state file — fail closed (start fresh) rather than
      // crashing the whole ingest job.
      log.warn({ err: String(err) }, "ingestionState.loadFailed");
      return new IngestionState({ version: 1, updatedAt: new Date().toISOString(), seenChunks: {} });
    }
  }

  /** Has this exact chunk text been seen before? */
  has(text: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.file.seenChunks, contentHash(text));
  }

  /** Mark a chunk as successfully ingested. No-op if already seen. */
  markSeen(text: string): void {
    const h = contentHash(text);
    if (!Object.prototype.hasOwnProperty.call(this.file.seenChunks, h)) {
      this.file.seenChunks[h] = new Date().toISOString();
      this.dirty = true;
    }
  }

  /** How many unique chunks have we ever written? */
  size(): number {
    return Object.keys(this.file.seenChunks).length;
  }

  /** Persist to disk. */
  async save(): Promise<void> {
    if (!this.dirty) return;
    this.file.updatedAt = new Date().toISOString();
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(this.file, null, 2), "utf8");
    this.dirty = false;
    log.info({ count: this.size(), path: STATE_FILE }, "ingestionState.saved");
  }
}
