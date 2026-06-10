/**
 * tests/backend/prompt.test.ts
 * ----------------------------------------------------------------------------
 * Unit tests for prompt construction.
 *
 * Why these tests:
 *   The prompt is the single most important file in a RAG app — if
 *   it's malformed the model hallucinates. We assert:
 *     - The rules section is present in every prompt.
 *     - The sources block contains the right number of entries.
 *     - The empty-retrieval case still produces a usable prompt
 *       (so the model's refusal rule is intact).
 *     - Long snippets are truncated.
 *     - The few-shot example is present so the model imitates the
 *       citation format.
 * ----------------------------------------------------------------------------
 */
import { describe, it, expect } from "vitest";

import { buildPrompt, buildSystemPrompt } from "@/backend/rag/prompt";
import type { RetrievedChunk } from "@/lib/vector-store-reader";

describe("prompt", () => {
  it("includes the rules section in every prompt", () => {
    const out = buildSystemPrompt([]);
    expect(out).toMatch(/You are Mastra Expert/);
    expect(out).toMatch(/Citations/);
    expect(out).toMatch(/Refusal/);
  });

  it("numbers sources starting at [1]", () => {
    const chunks: RetrievedChunk[] = [
      { id: "a#1", text: "alpha", score: 0.9 },
      { id: "b#1", text: "beta", score: 0.7 },
    ];
    const out = buildSystemPrompt(chunks);
    expect(out).toContain("[1] alpha");
    expect(out).toContain("[2] beta");
  });

  it("truncates long snippets at the configured character budget", () => {
    const long = "x".repeat(5000);
    const chunks: RetrievedChunk[] = [{ id: "x#1", text: long, score: 0.9 }];
    const out = buildSystemPrompt(chunks);
    // 1200 cap + ellipsis
    const idx = out.indexOf("[1] ");
    const snippet = out.slice(idx + 4, idx + 4 + 2000);
    expect(snippet).toContain("…");
    expect(snippet.length).toBeLessThan(2000);
  });

  it("emits a refusal-eligible prompt when retrieval is empty", () => {
    const out = buildSystemPrompt([]);
    expect(out).toMatch(/none retrieved/);
    expect(out).toMatch(/refusal/);
  });

  it("includes the few-shot example so the model imitates citation format", () => {
    const out = buildSystemPrompt([
      { id: "x#1", text: "t", score: 0.9 },
    ]);
    expect(out).toContain("Example");
    expect(out).toContain("[1]");
    expect(out).toContain("PgVector");
  });

  it("user message is unchanged when there are no prior turns", () => {
    const out = buildPrompt(
      [{ id: "x#1", text: "ctx", score: 0.9 }],
      "What is pgvector?",
    );
    expect(out.userMessage).toBe("What is pgvector?");
  });

  it("user message includes recap when there are prior turns", () => {
    const out = buildPrompt(
      [{ id: "x#1", text: "ctx", score: 0.9 }],
      "And how do I configure it?",
      [
        { role: "user", text: "What is pgvector?" },
        { role: "assistant", text: "It is a Postgres extension." },
      ],
    );
    expect(out.userMessage).toContain("Conversation recap");
    expect(out.userMessage).toContain("What is pgvector?");
    expect(out.userMessage).toContain("And how do I configure it?");
  });

  it("buildPrompt returns both system and userMessage", () => {
    const out = buildPrompt(
      [{ id: "x#1", text: "t", score: 0.9 }],
      "q",
    );
    expect(out.system.length).toBeGreaterThan(0);
    expect(out.userMessage.length).toBeGreaterThan(0);
  });

  it("does not leak the corpus URL into the prompt (security smoke)", () => {
    const chunks: RetrievedChunk[] = [
      {
        id: "x#1",
        text: "public content",
        score: 0.9,
        metadata: { url: "https://internal.example.com/secret", title: "internal" },
      },
    ];
    const out = buildSystemPrompt(chunks);
    // We deliberately don't put the URL in the system prompt; the
    // UI shows the URL, not the LLM. The chunk's text is fair game.
    expect(out).not.toContain("internal.example.com");
  });
});
