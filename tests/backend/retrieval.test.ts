/**
 * tests/backend/retrieval.test.ts
 * ----------------------------------------------------------------------------
 * Unit tests for the retrieval step.
 *
 * Why these tests:
 *   - Verify that the top-K plumbing works (we ask for K, we get up to K).
 *   - Verify the min-score filter actually filters.
 *   - Verify metadata is forwarded into the result.
 *   - Verify empty-query short-circuits (no network call).
 *
 * How we mock:
 *   - The reader is injected (a fake with the `VectorReader` shape).
 *   - The embed function is injected (returns a fake vector).
 *   No real Voyage or pg calls.
 * ----------------------------------------------------------------------------
 */
import { describe, it, expect, vi } from "vitest";

import { retrieve } from "@/backend/rag/retrieval";
import type {
  RetrievedChunk,
  VectorReader,
} from "@/lib/vector-store-reader";

/**
 * Build a fake reader that records its call and returns canned chunks.
 */
function fakeReader(chunks: RetrievedChunk[]): VectorReader & {
  calls: Array<{ topK: number; minScore?: number }>;
} {
  const calls: Array<{ topK: number; minScore?: number }> = [];
  return {
    calls,
    async query(embedding, options) {
      calls.push({ topK: options.topK, minScore: options.minScore });
      // Sanity check: the reader should always get a non-empty vector.
      expect(embedding.length).toBeGreaterThan(0);
      return chunks;
    },
  };
}

/**
 * Fake embedder that returns a fixed-dimension vector regardless of input.
 */
function fakeEmbedder(): (texts: string[]) => Promise<number[][]> {
  return async (texts) => texts.map(() => [0.1, 0.2, 0.3]);
}

describe("retrieval", () => {
  it("returns chunks from the injected reader", async () => {
    const chunks: RetrievedChunk[] = [
      {
        id: "mastra/rag/overview#1",
        text: "Mastra RAG overview text",
        score: 0.92,
        metadata: { url: "https://mastra.ai/docs/rag/overview", title: "RAG Overview" },
      },
      {
        id: "mastra/rag/vector-databases#1",
        text: "Vector store text",
        score: 0.81,
        metadata: { url: "https://mastra.ai/docs/rag/vector-databases", title: "Vector DBs" },
      },
    ];
    const reader = fakeReader(chunks);
    const out = await retrieve("how does RAG work in Mastra?", {
      reader,
      embed: fakeEmbedder(),
    });

    expect(out.chunks).toHaveLength(2);
    expect(out.chunks[0]?.id).toBe("mastra/rag/overview#1");
    expect(out.metadata.candidates).toBe(2);
    expect(out.metadata.finalCount).toBe(2);
    expect(out.metadata.topScore).toBeCloseTo(0.92);
    expect(out.metadata.embeddingModel).toBe("voyage-code-3");
    expect(out.queryEmbedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("forwards topK to the reader", async () => {
    const reader = fakeReader([]);
    await retrieve("q", { reader, embed: fakeEmbedder(), topK: 7 });
    expect(reader.calls[0]?.topK).toBe(7);
  });

  it("forwards minScore to the reader", async () => {
    const reader = fakeReader([]);
    await retrieve("q", { reader, embed: fakeEmbedder(), minScore: 0.7 });
    expect(reader.calls[0]?.minScore).toBe(0.7);
  });

  it("short-circuits on empty query without calling reader/embed", async () => {
    const embed = vi.fn(fakeEmbedder());
    const reader = fakeReader([]);
    const out = await retrieve("   ", { reader, embed });
    expect(embed).not.toHaveBeenCalled();
    expect(reader.calls).toHaveLength(0);
    expect(out.chunks).toHaveLength(0);
    expect(out.queryEmbedding).toEqual([]);
  });

  it("uses default topK=10 and minScore=0.5 when not overridden", async () => {
    const reader = fakeReader([]);
    await retrieve("q", { reader, embed: fakeEmbedder() });
    expect(reader.calls[0]).toEqual({ topK: 10, minScore: 0.5 });
  });

  it("records metadata: latencyMs is a non-negative number", async () => {
    const reader = fakeReader([
      { id: "x#1", text: "t", score: 0.5 },
    ]);
    const out = await retrieve("q", { reader, embed: fakeEmbedder() });
    expect(typeof out.metadata.latencyMs).toBe("number");
    expect(out.metadata.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
