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

  it("returns chunks from the injected reader, deduplicated across the broad-merge pass", async () => {
    // The reader is called twice (strict + broad). Distinct chunks per
    // call simulate realistic retrieval. The broad-pass chunks merge
    // into the strict-pass result with the per-article cap applied.
    let callIdx = 0;
    const reader = {
      calls: [] as Array<{ topK: number; minScore?: number }>,
      query: async () => {
        const i = callIdx++;
        return i === 0
          ? ([
              {
                id: "ai-act/article-6#1",
                text: "AI system is high-risk if listed in Annex III",
                score: 0.92,
                metadata: { sourceId: "ai-act/article-6", url: "u1", title: "Article 6" },
              },
              {
                id: "ai-act/article-6#2",
                text: "third-party conformity assessment",
                score: 0.85,
                metadata: { sourceId: "ai-act/article-6", url: "u1", title: "Article 6" },
              },
            ] as RetrievedChunk[])
          : ([
              {
                id: "ai-act/article-50#1",
                text: "transparency obligations for limited-risk systems",
                score: 0.21,
                metadata: { sourceId: "ai-act/article-50", url: "u2", title: "Article 50" },
              },
            ] as RetrievedChunk[]);
      },
    };
    const out = await retrieve("how does RAG work in Mastra?", {
      reader: reader as unknown as VectorReader,
      embed: fakeEmbedder(),
    });

    // Strict pass keeps 2 chunks from article-6; broad pass adds article-50;
    // both articles are distinct so all 3 survive the per-article cap.
    expect(out.chunks).toHaveLength(3);
    expect(out.chunks[0]?.id).toBe("ai-act/article-6#1");
    expect(out.metadata.candidates).toBe(3);
    expect(out.metadata.finalCount).toBe(3);
    expect(out.metadata.topScore).toBeCloseTo(0.92);
    expect(out.metadata.embeddingModel).toBe("voyage-law-2");
    expect(out.metadata.uniqueSources).toBe(2);
    expect(out.queryEmbedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("forwards topK to the reader (widened by STRICT_CANDIDATE_MULTIPLIER for the per-article cap)", async () => {
    const reader = fakeReader([]);
    await retrieve("q", { reader, embed: fakeEmbedder(), topK: 7 });
    // topK=7 * STRICT_CANDIDATE_MULTIPLIER=4 = 28.
    expect(reader.calls[0]?.topK).toBe(28);
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
  it("uses default topK=12 and minScore=0.4 when not overridden, and widens the candidate window for the per-article cap", async () => {
    const reader = fakeReader([]);
    await retrieve("q", { reader, embed: fakeEmbedder() });
    // STRICT_CANDIDATE_MULTIPLIER = 4 -> strict pass asks for topK*4 = 48.
    expect(reader.calls[0]).toEqual({ topK: 48, minScore: 0.4 });
  });
  it("records metadata: latencyMs is a non-negative number", async () => {
    const reader = fakeReader([
      { id: "x#1", text: "t", score: 0.5 },
    ]);
    const out = await retrieve("q", { reader, embed: fakeEmbedder() });
    expect(typeof out.metadata.latencyMs).toBe("number");
    expect(out.metadata.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("enforces per-article cap by deduplicating on metadata.sourceId", async () => {
    // 5 chunks all from the same article — cap=3 must keep exactly 3
    // even though the reader returned 5 and topK=4.
    const chunks: RetrievedChunk[] = [
      { id: "ai-act/article-6#1", text: "t1", score: 0.95, metadata: { sourceId: "ai-act/article-6", url: "u", title: "t" } },
      { id: "ai-act/article-6#2", text: "t2", score: 0.90, metadata: { sourceId: "ai-act/article-6", url: "u", title: "t" } },
      { id: "ai-act/article-6#3", text: "t3", score: 0.85, metadata: { sourceId: "ai-act/article-6", url: "u", title: "t" } },
      { id: "ai-act/article-6#4", text: "t4", score: 0.80, metadata: { sourceId: "ai-act/article-6", url: "u", title: "t" } },
      { id: "ai-act/article-6#5", text: "t5", score: 0.75, metadata: { sourceId: "ai-act/article-6", url: "u", title: "t" } },
    ];
    const out = await retrieve("q", {
      reader: fakeReader(chunks),
      embed: fakeEmbedder(),
      topK: 4,
      perArticleCap: 3,
    });
    expect(out.chunks).toHaveLength(3);
    // Score order preserved.
    expect(out.chunks.map((c) => c.score)).toEqual([0.95, 0.9, 0.85]);
    // Diversity metadata reflects the capped cluster.
    expect(out.metadata.uniqueSources).toBe(1);
    expect(out.metadata.maxPerArticle).toBe(3);
  });

  it("per-article cap lets survivors from multiple articles through", async () => {
    // Scores in order: 0.95, 0.93, 0.91 from article-6; 0.90 article-5;
    // 0.85 article-10. With topK=4 + cap=3, greedy takes all 3 of
    // article-6 first (slots 1-3), then article-5 (slot 4). Article-10
    // never reaches a slot.
    const chunks: RetrievedChunk[] = [
      { id: "ai-act/article-6#1", text: "a", score: 0.95, metadata: { sourceId: "ai-act/article-6", url: "u", title: "t" } },
      { id: "ai-act/article-6#2", text: "b", score: 0.93, metadata: { sourceId: "ai-act/article-6", url: "u", title: "t" } },
      { id: "ai-act/article-6#3", text: "c", score: 0.91, metadata: { sourceId: "ai-act/article-6", url: "u", title: "t" } },
      { id: "ai-act/article-5#1", text: "d", score: 0.90, metadata: { sourceId: "ai-act/article-5", url: "u", title: "t" } },
      { id: "ai-act/article-10#1", text: "e", score: 0.85, metadata: { sourceId: "ai-act/article-10", url: "u", title: "t" } },
    ];
    const out = await retrieve("q", {
      reader: fakeReader(chunks),
      embed: fakeEmbedder(),
      topK: 4,
      perArticleCap: 3,
    });
    expect(out.chunks).toHaveLength(4);
    const ids = out.chunks.map((c) => c.id);
    expect(ids.filter((i) => i?.startsWith("ai-act/article-6"))).toHaveLength(3);
    expect(out.metadata.uniqueSources).toBe(2);
    expect(out.metadata.maxPerArticle).toBe(3);
  });

  it("per-article cap can be disabled with perArticleCap: null", async () => {
    const chunks: RetrievedChunk[] = [
      { id: "a#1", text: "1", score: 0.9, metadata: { sourceId: "a" } },
      { id: "a#2", text: "2", score: 0.8, metadata: { sourceId: "a" } },
      { id: "a#3", text: "3", score: 0.7, metadata: { sourceId: "a" } },
      { id: "a#4", text: "4", score: 0.6, metadata: { sourceId: "a" } },
    ];
    const out = await retrieve("q", {
      reader: fakeReader(chunks),
      embed: fakeEmbedder(),
      topK: 4,
      perArticleCap: null,
    });
    // With cap disabled we keep all 4 in score order.
    expect(out.chunks).toHaveLength(4);
    expect(out.metadata.maxPerArticle).toBe(4);
  });
});
