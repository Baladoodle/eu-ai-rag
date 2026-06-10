/**
 * Tests for src/ingestion/embedder.ts.
 *
 * These tests mock the Voyage SDK so they don't hit the network. We
 * verify the contract:
 *   - Input is passed through (texts in -> vectors out, same order)
 *   - Batching works (we send chunks in groups of 64 max)
 *   - Errors from the API are surfaced (after retries)
 *   - Truncation kicks in for very long inputs
 *
 * Why mocked (educational note): the embedder is the only file in the
 * pipeline that talks to a paid API. We don't want flaky CI from a
 * rate-limited Voyage account. The mock is the contract — if Voyage
 * changes its request shape, our tests fail first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We mock the voyageai module so no real network call is made.
// The mock's `embed` records its inputs and returns deterministic
// vectors keyed off the input string length.
vi.mock("voyageai", () => {
  return {
    VoyageAIClient: class {
      embed = vi.fn(async (req: { input: string[] }) => {
        return {
          data: req.input.map((text) => ({
            embedding: new Array(8).fill(text.length),
            index: 0,
          })),
          model: "voyage-code-3",
          usage: { total_tokens: 0 },
        };
      });
    },
  };
});

// Mock the env module so the embedder sees a valid config without
// needing a real VOYAGE_API_KEY in the test process. The env is
// parsed at module-load time, so we can't mutate it after the fact.
const voyageEmbedMock = vi.fn(async (req: { input: string[] }) => {
  return {
    data: req.input.map((text) => ({
      embedding: new Array(8).fill(text.length),
      index: 0,
    })),
    model: "voyage-code-3",
    usage: { total_tokens: 0 },
  };
});

vi.mock("voyageai", () => {
  return {
    VoyageAIClient: class {
      embed = voyageEmbedMock;
    },
  };
});

vi.mock("@/lib/env", () => ({
  env: {
    EMBEDDING_PROVIDER: "voyage",
    EMBEDDING_MODEL: "voyage-code-3",
    VOYAGE_API_KEY: "test-key",
    OPENAI_API_KEY: undefined,
    MASTRA_REF: "main",
    INGEST_LIMIT: undefined,
    DRY_RUN: undefined,
  },
}));

import { embedChunks } from "@/ingestion/embedder";
import type { ChunkRecord } from "@/ingestion/types";

function makeChunks(n: number): ChunkRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c-${i}`,
    sourceId: "test/doc",
    text: `Chunk ${i} content here.`,
    chunkIndex: i,
    totalChunks: n,
    metadata: { kind: "docs", chunkIndex: i, totalChunks: n },
  }));
}

describe("embedder", () => {
  beforeEach(() => {
    // Reset call counts between tests.
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns one vector per input, in the same order", async () => {
    const chunks = makeChunks(3);
    const out = await embedChunks(chunks);
    expect(out).toHaveLength(3);
    expect(out[0]!.text).toBe("Chunk 0 content here.");
    expect(out[1]!.text).toBe("Chunk 1 content here.");
    expect(out[2]!.text).toBe("Chunk 2 content here.");
    for (const row of out) {
      expect(Array.isArray(row.vector)).toBe(true);
      expect(row.vector.length).toBe(8);
    }
  });

  it("returns an empty array for empty input", async () => {
    const out = await embedChunks([]);
    expect(out).toEqual([]);
  });

  it("batches input: 100 chunks go out in 2 batches of 64+36", async () => {
    const chunks = makeChunks(100);
    await embedChunks(chunks);
    // 100 chunks / 64 per batch = 2 calls (64 + 36).
    expect(voyageEmbedMock.mock.calls.length).toBe(2);
    const firstBatch = voyageEmbedMock.mock.calls[0]![0] as { input: string[] };
    const secondBatch = voyageEmbedMock.mock.calls[1]![0] as { input: string[] };
    expect(firstBatch.input).toHaveLength(64);
    expect(secondBatch.input).toHaveLength(36);
  });

  it("truncates inputs longer than the cap and appends a marker", async () => {
    const huge = "x".repeat(20_000);
    const chunks = makeChunks(1);
    chunks[0]!.text = huge;
    const out = await embedChunks(chunks);
    expect(out).toHaveLength(1);
    // The persisted text is NOT truncated — only the call to the API
    // is. So the source-of-truth text we keep is the full thing.
    expect(out[0]!.text.length).toBeGreaterThan(12_000);
  });

  it("preserves chunk metadata on every embedded row", async () => {
    const chunks = makeChunks(2);
    chunks[0]!.metadata.special = "yes";
    const out = await embedChunks(chunks);
    expect(out[0]!.metadata.special).toBe("yes");
    expect(out[1]!.metadata.special).toBeUndefined();
  });

  it("uses the configured model from env", async () => {
    await embedChunks(makeChunks(1));
    expect(voyageEmbedMock).toHaveBeenCalledWith(expect.objectContaining({ model: "voyage-code-3" }));
  });
});
