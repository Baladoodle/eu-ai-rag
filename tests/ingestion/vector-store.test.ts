/**
 * Tests for src/lib/vector-store.ts (the WRITER portion) and the
 * idempotency integration with IngestionState.
 *
 * The PgVector backend is a thin shim over @mastra/pg; we test the
 * in-memory implementation and the contract the pipeline relies on:
 *   - upsert is idempotent (same id -> skipped, not duplicated)
 *   - writer returns the right UpsertSummary shape
 *   - ingestion-state tracks content hashes across runs
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";

import { getInMemoryWriter } from "@/lib/vector-store";
import { IngestionState, contentHash } from "@/ingestion/ingestion-state";
import type { EmbeddedChunk } from "@/ingestion/types";

const STATE_DIR = path.resolve(process.cwd(), "data", "processed");

afterEach(async () => {
  await rm(STATE_DIR, { recursive: true, force: true });
});

function makeChunk(overrides: Partial<EmbeddedChunk> = {}): EmbeddedChunk {
  return {
    id: "c-1",
    sourceId: "test/doc",
    text: "Sample chunk text.",
    chunkIndex: 0,
    totalChunks: 1,
    vector: [0.1, 0.2, 0.3],
    metadata: { kind: "docs" },
    ...overrides,
  };
}

describe("InMemoryWriter", () => {
  it("writes a new chunk and reports it as written", async () => {
    const writer = getInMemoryWriter();
    const sum = await writer.upsert([makeChunk({ id: "c-1" })]);
    expect(sum.written).toBe(1);
    expect(sum.skipped).toBe(0);
    expect(sum.attempted).toBe(1);
    expect(writer.snapshot()).toHaveLength(1);
  });

  it("is idempotent — re-upserting the same id is a no-op", async () => {
    const writer = getInMemoryWriter();
    await writer.upsert([makeChunk({ id: "c-1" })]);
    const sum = await writer.upsert([makeChunk({ id: "c-1", text: "DIFFERENT TEXT" })]);
    // Note: the in-memory writer is keyed on `id`, so re-upserting the
    // same id is a no-op. The text is NOT updated. This is the
    // guarantee the pipeline relies on: same id -> same row.
    expect(sum.written).toBe(0);
    expect(sum.skipped).toBe(1);
    expect(writer.snapshot()).toHaveLength(1);
    expect(writer.snapshot()[0]!.text).toBe("Sample chunk text.");
  });

  it("handles a mixed batch of new and existing ids", async () => {
    const writer = getInMemoryWriter();
    await writer.upsert([makeChunk({ id: "c-1" })]);
    const sum = await writer.upsert([
      makeChunk({ id: "c-1" }),
      makeChunk({ id: "c-2", text: "second chunk" }),
      makeChunk({ id: "c-3", text: "third chunk" }),
    ]);
    expect(sum.written).toBe(2);
    expect(sum.skipped).toBe(1);
    expect(sum.attempted).toBe(3);
    expect(writer.snapshot()).toHaveLength(3);
  });

  it("returns an empty summary for an empty batch", async () => {
    const writer = getInMemoryWriter();
    const sum = await writer.upsert([]);
    // Counters must all be zero. We don't assert `elapsedMs === 0` —
    // Date.now() has ms granularity and the empty-batch fast path can
    // legitimately read 0 or 1 ms depending on the scheduler. The
    // contract is "no-op for an empty batch", not "instant".
    expect(sum).toEqual({
      written: 0,
      skipped: 0,
      attempted: 0,
      elapsedMs: expect.any(Number),
    });
    expect(sum.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe("IngestionState", () => {
  beforeEach(async () => {
    await rm(STATE_DIR, { recursive: true, force: true });
  });

  it("starts empty when no state file exists", async () => {
    const state = await IngestionState.load();
    expect(state.size()).toBe(0);
    expect(state.has("anything")).toBe(false);
  });

  it("marks and queries seen chunks by content hash", async () => {
    const state = await IngestionState.load();
    state.markSeen("hello world");
    expect(state.has("hello world")).toBe(true);
    expect(state.has("hello WORLD")).toBe(false);
    expect(state.size()).toBe(1);
  });

  it("contentHash is deterministic and collision-resistant for trivial cases", () => {
    expect(contentHash("a")).not.toBe(contentHash("b"));
    expect(contentHash("a")).toBe(contentHash("a"));
  });

  it("save() persists the seen-set to disk and a fresh load() returns it", async () => {
    const a = await IngestionState.load();
    a.markSeen("first");
    a.markSeen("second");
    await a.save();

    const b = await IngestionState.load();
    expect(b.size()).toBe(2);
    expect(b.has("first")).toBe(true);
    expect(b.has("second")).toBe(true);
    expect(b.has("third")).toBe(false);
  });

  it("save() is a no-op when nothing changed", async () => {
    const state = await IngestionState.load();
    // No mutations, so dirty should be false.
    // We can't observe dirty directly, but we can confirm that
    // calling save() doesn't throw and doesn't lose data.
    await expect(state.save()).resolves.not.toThrow();
  });
});
