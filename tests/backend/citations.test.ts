/**
 * tests/backend/citations.test.ts
 * ----------------------------------------------------------------------------
 * Unit tests for citation extraction and formatting.
 *
 * Why these tests:
 *   Citations are the bridge between the LLM's text and the source
 *   list. If a test here fails, the UI's [1] chips won't link to the
 *   right source.
 *
 * What we cover:
 *   - Building `Source` objects from chunks (stable id, snippet, score).
 *   - Building `Citation` objects (1-based index).
 *   - Extracting citation markers from assistant text.
 *   - Counting citations for the eval scorer.
 *   - Stripping markers for substring matching in evals.
 * ----------------------------------------------------------------------------
 */
import { describe, it, expect } from "vitest";

import {
  buildCitations,
  buildSources,
  citationMarkerRegex,
  countCitations,
  extractCitationIndices,
  stripCitationMarkers,
} from "@/backend/rag/citations";
import type { RetrievedChunk } from "@/lib/vector-store-reader";

const fixedNow = () => new Date("2026-06-10T12:00:00.000Z");

describe("citations", () => {
  const chunks: RetrievedChunk[] = [
    {
      id: "mastra/rag/overview#1",
      text: "Overview of Mastra RAG",
      score: 0.92,
      metadata: { url: "https://mastra.ai/docs/rag/overview", title: "RAG Overview" },
    },
    {
      id: "mastra/rag/vector-databases#1",
      text: "Vector store configuration",
      score: 0.81,
      metadata: { url: "https://mastra.ai/docs/rag/vector-databases", title: "Vector DBs", section: "pgvector" },
    },
  ];

  it("buildSources produces a stable id, title, url, and ISO timestamp", () => {
    const sources = buildSources(chunks, { embeddingModel: "voyage-code-3", now: fixedNow });
    expect(sources).toHaveLength(2);
    expect(sources[0]?.id).toBe("mastra/rag/overview#1#1");
    expect(sources[0]?.title).toBe("RAG Overview");
    expect(sources[0]?.url).toBe("https://mastra.ai/docs/rag/overview");
    expect(sources[0]).not.toHaveProperty("score");
    expect(sources[0]?.retrievedAt).toBe("2026-06-10T12:00:00.000Z");
  });

  it("buildSources includes section when present in metadata", () => {
    const sources = buildSources(chunks, { embeddingModel: "voyage-code-3", now: fixedNow });
    expect(sources[1]?.section).toBe("pgvector");
  });

  it("buildSources pins articleNumber on the wire when present in chunk metadata", () => {
    const sources = buildSources(
      [
        {
          id: "ai-act/article-16#1",
          text: "Provider obligations under Article 16.",
          score: 0.9,
          metadata: {
            url: "https://artificialintelligenceact.eu/article/16/",
            title: "Article 16",
            articleNumber: 16,
          },
        },
        {
          id: "ai-act/recital-10#1",
          text: "Recital 10 explains background.",
          score: 0.7,
          metadata: {
            url: "https://artificialintelligenceact.eu/recital/10/",
            title: "Recital 10",
          },
        },
      ],
      { embeddingModel: "voyage-code-3", now: fixedNow },
    );
    expect(sources[0]?.articleNumber).toBe("16");
    // Recital/Annex chunks without articleNumber in metadata emit no field
    // (JSON.stringify drops undefined optional fields, wire stays minimal).
    expect(sources[1]?.articleNumber).toBeUndefined();
    expect(sources[1]).not.toHaveProperty("articleNumber");
  });

  it("buildSources falls back to a sensible title when metadata is missing", () => {
    const sources = buildSources(
      [{ id: "x#1", text: "t", score: 0.5 }],
      { embeddingModel: "voyage-code-3", now: fixedNow },
    );
    expect(sources[0]?.title).toBe("Untitled source");
  });

  it("buildCitations assigns 1-based indices", () => {
    const citations = buildCitations(chunks, { embeddingModel: "voyage-code-3", now: fixedNow });
    expect(citations.map((c) => c.index)).toEqual([1, 2]);
    expect(citations[1]?.source.title).toBe("Vector DBs");
  });

  it("extractCitationIndices returns sorted unique indices", () => {
    const text = "Mastra uses PgVector [1] and MDocument [2]. Also see the overview [1].";
    expect(extractCitationIndices(text)).toEqual([1, 2]);
  });

  it("extractCitationIndices ignores non-numeric and large markers", () => {
    const text = "Year [2024] is fine. Citation [3] works. Citation [123] is dropped.";
    expect(extractCitationIndices(text)).toEqual([3]);
  });

  it("extractCitationIndices returns empty array for text with no markers", () => {
    expect(extractCitationIndices("Just plain text, no citations.")).toEqual([]);
  });

  it("citationMarkerRegex matches [1], [12], [99] but not [100]", () => {
    const regex = citationMarkerRegex();
    const flags = regex.flags;
    expect(flags).toContain("g");
    const text = "[1] [12] [99] [100]";
    const matches = text.match(regex) ?? [];
    expect(matches).toEqual(["[1]", "[12]", "[99]"]);
  });

  it("countCitations equals the number of unique indices", () => {
    const text = "Foo [1] bar [2] baz [1] qux [3]";
    expect(countCitations(text)).toBe(3);
  });

  it("stripCitationMarkers removes [n] tokens and collapses whitespace", () => {
    const text = "Mastra uses   PgVector [1] for vector storage [2].";
    const out = stripCitationMarkers(text);
    expect(out).not.toContain("[1]");
    expect(out).not.toContain("[2]");
    expect(out).toContain("Mastra uses PgVector for vector storage");
  });

  it("end-to-end: chunks -> citations -> matches text markers", () => {
    const citations = buildCitations(chunks, { embeddingModel: "voyage-code-3", now: fixedNow });
    const assistantText =
      "Use PgVector for production [1]. See the overview for context [2].";
    const used = extractCitationIndices(assistantText);
    // Both citations should be referenced.
    expect(used).toEqual([1, 2]);
    // Every cited index maps to a real citation.
    for (const i of used) {
      expect(citations[i - 1]).toBeDefined();
    }
  });
});
