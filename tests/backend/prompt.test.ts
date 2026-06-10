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
 *     - Article, Recital, and Annex labels render in the sources block
 *       so the model can cite the right kind of source.
 * ----------------------------------------------------------------------------
 */
import { describe, it, expect } from "vitest";

import { buildPrompt, buildSystemPrompt } from "@/backend/rag/prompt";
import type { RetrievedChunk } from "@/lib/vector-store-reader";

describe("prompt", () => {
  it("includes the rules section in every prompt", () => {
    const out = buildSystemPrompt([]);
    expect(out).toMatch(/You are EU AI Act Expert/);
    expect(out).toMatch(/Citations/);
    expect(out).toMatch(/Refusal/);
  });

  it("numbers sources starting at [1]", () => {
    const chunks: RetrievedChunk[] = [
      { id: "a#1", text: "alpha", score: 0.9 },
      { id: "b#1", text: "beta", score: 0.7 },
    ];
    const out = buildSystemPrompt(chunks);
    expect(out).toContain("[1]");
    expect(out).toContain("alpha");
    expect(out).toContain("[2]");
    expect(out).toContain("beta");
  });

  it("labels Article and Recital chunks so the model cites the right kind", () => {
    const chunks: RetrievedChunk[] = [
      {
        id: "ai-act/article-3#0",
        text: "Definitions",
        score: 0.9,
        metadata: { kind: "article", articleNumber: 3 },
      },
      {
        id: "ai-act/recital-10#0",
        text: "GDPR relationship",
        score: 0.8,
        metadata: { kind: "recital", recitalNumber: 10 },
      },
    ];
    const out = buildSystemPrompt(chunks);
    expect(out).toContain("Article 3");
    expect(out).toContain("Recital 10");
  });

  it("truncates long snippets at the configured character budget", () => {
    const long = "x".repeat(5000);
    const chunks: RetrievedChunk[] = [{ id: "x#1", text: long, score: 0.9 }];
    const out = buildSystemPrompt(chunks);
    // The first "[1]" in the prompt is part of the few-shot example, not
    // the sources block. Anchor on the sources block heading to find the
    // real first source entry.
    const blockStart = out.indexOf("## Sources");
    const idx = out.indexOf("[1]", blockStart);
    const snippet = out.slice(idx, idx + 2000);
    expect(snippet).toContain("…");
    expect(snippet.length).toBeLessThan(2000);
  });

  it("emits a refusal-eligible prompt when retrieval is empty", () => {
    const out = buildSystemPrompt([]);
    expect(out).toMatch(/none retrieved/);
    expect(out).toMatch(/refusal/i);
  });

  it("includes the few-shot example so the model imitates citation format", () => {
    const out = buildSystemPrompt([
      { id: "x#1", text: "t", score: 0.9 },
    ]);
    expect(out).toContain("Example");
    expect(out).toContain("[1]");
    // The example now references an Article (the EU AI Act domain).
    expect(out).toContain("Article 6");
  });

  it("user message is unchanged when there are no prior turns", () => {
    const out = buildPrompt(
      [{ id: "x#1", text: "ctx", score: 0.9 }],
      "What is Article 6?",
    );
    expect(out.userMessage).toBe("What is Article 6?");
  });

  it("user message includes recap when there are prior turns", () => {
    const out = buildPrompt(
      [{ id: "x#1", text: "ctx", score: 0.9 }],
      "And how does it apply to biometric ID?",
      [
        { role: "user", text: "What is Article 6?" },
        { role: "assistant", text: "Article 6 sets the two paths to high-risk." },
      ],
    );
    expect(out.userMessage).toContain("Conversation recap");
    expect(out.userMessage).toContain("What is Article 6?");
    expect(out.userMessage).toContain("And how does it apply to biometric ID?");
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

  it("distinguishes Article text from Recital rationale in the prompt rules", () => {
    const out = buildSystemPrompt([]);
    // The rules must mention both Articles and Recitals, and must tell
    // the model that Recitals are not binding.
    expect(out).toMatch(/Article/);
    expect(out).toMatch(/Recital/);
    expect(out).toMatch(/not themselves enforceable|enforceabl/i);
  });

  it("refuses to give legal advice and points the user to a lawyer", () => {
    const out = buildSystemPrompt([]);
    expect(out).toMatch(/legal advice/i);
    expect(out).toMatch(/qualified EU regulatory lawyer/i);
  });
});
