/**
 * Tests for src/ingestion/chunker.ts.
 *
 * Why these tests (educational note for someone new to RAGs):
 *   The chunker is the single biggest determinant of retrieval
 *   quality. If chunks are too small, the model doesn't have enough
 *   context. If they're too large, the cosine similarity signal is
 *   diluted. If overlap is wrong, sentences at the boundary get
 *   lost. We test the boundaries, the overlap, and the edge cases
 *   (empty input, very large input, special characters).
 */
import { describe, it, expect } from "vitest";
import { chunkDocument, buildChunkId, CHUNK_SIZE, CHUNK_OVERLAP } from "@/ingestion/chunker";
import type { RawDocument } from "@/ingestion/types";

function makeDoc(overrides: Partial<RawDocument> = {}): RawDocument {
  return {
    sourceId: "test/doc-1",
    url: "https://example.com/docs/doc-1",
    title: "Test Doc",
    text: "Hello world. ".repeat(200),
    kind: "docs",
    metadata: { source: "unit-test" },
    ...overrides,
  };
}

describe("chunker", () => {
  it("produces non-empty chunks for a normal document", async () => {
    const chunks = await chunkDocument(makeDoc());
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.sourceId).toBe("test/doc-1");
    }
  });

  it("respects CHUNK_SIZE — no chunk is dramatically larger than the cap", async () => {
    const doc = makeDoc({ text: "a".repeat(CHUNK_SIZE * 5) });
    const chunks = await chunkDocument(doc);
    // Allow up to ~2x CHUNK_SIZE because some chunkers can produce a
    // single chunk that exceeds the target on a long homogeneous input
    // (the cost of not splitting mid-character). We just need to
    // confirm we don't have a chunk that contains the entire input.
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(CHUNK_SIZE * 2);
    }
  });

  it("adds overlap — adjacent chunks share some text", async () => {
    const doc = makeDoc({ text: "Sentence one. Sentence two. ".repeat(500) });
    const chunks = await chunkDocument(doc);
    if (chunks.length < 2) return; // too short to assert overlap
    // Look for a non-trivial suffix/prefix match between consecutive chunks.
    const hasOverlap = chunks.some((c, i) => {
      if (i === chunks.length - 1) return false;
      const next = chunks[i + 1]!;
      const tail = c.text.slice(-CHUNK_OVERLAP);
      // Either the next chunk's head contains the previous tail's
      // beginning, or vice versa. We just check for any shared region.
      return next.text.includes(tail.slice(0, Math.min(40, CHUNK_OVERLAP)));
    });
    expect(hasOverlap).toBe(true);
  });

  it("returns an empty array for empty input (does not throw)", async () => {
    const chunks = await chunkDocument(makeDoc({ text: "" }));
    expect(chunks).toEqual([]);
  });

  it("returns an empty array for whitespace-only input", async () => {
    const chunks = await chunkDocument(makeDoc({ text: "   \n\n   " }));
    expect(chunks).toEqual([]);
  });

  it("handles very large documents without throwing", async () => {
    const doc = makeDoc({ text: "x".repeat(500_000) });
    const chunks = await chunkDocument(doc);
    expect(chunks.length).toBeGreaterThan(100);
  });

  it("handles code with special characters without losing them", async () => {
    const code = [
      "import { foo } from './bar';",
      "const greeting = `Hello, ${name}!`;",
      "function add<T extends number>(a: T, b: T): T { return a + b; }",
      "// TODO: handle unicode: 🚀 é 中文",
      "const regex = /^[a-z0-9_-]+$/i;",
    ].join("\n");
    const chunks = await chunkDocument(makeDoc({ text: code, kind: "source" }));
    const combined = chunks.map((c) => c.text).join("\n");
    expect(combined).toContain("🚀");
    expect(combined).toContain("中文");
    expect(combined).toContain("/^[a-z0-9_-]+$/i");
  });

  it("assigns sequential chunkIndex values starting at 0", async () => {
    const chunks = await chunkDocument(makeDoc());
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.chunkIndex).toBe(i);
    }
  });

  it("includes totalChunks on every chunk", async () => {
    const chunks = await chunkDocument(makeDoc());
    for (const c of chunks) {
      expect(c.totalChunks).toBe(chunks.length);
    }
  });

  it("buildChunkId is deterministic for the same inputs", () => {
    const a = buildChunkId("src/x", 3);
    const b = buildChunkId("src/x", 3);
    expect(a).toBe(b);
  });

  it("buildChunkId differs for different chunk indices", () => {
    expect(buildChunkId("src/x", 0)).not.toBe(buildChunkId("src/x", 1));
  });

  it("buildChunkId differs for different source ids", () => {
    expect(buildChunkId("src/x", 0)).not.toBe(buildChunkId("src/y", 0));
  });

  it("preserves source-level metadata on every chunk", async () => {
    const chunks = await chunkDocument(
      makeDoc({ metadata: { kind: "docs", repoPath: "n/a", extra: "hello" } }),
    );
    for (const c of chunks) {
      expect(c.metadata.extra).toBe("hello");
      expect(c.metadata.kind).toBe("docs");
    }
  });
});
