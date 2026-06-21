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
    const snippet = out.slice(idx, idx + 4000);
    expect(snippet).toContain("…");
    expect(snippet.length).toBeLessThan(4000);
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

  it("refuses when sources do not address the question and offers no extra commentary", () => {
    const out = buildSystemPrompt([]);
    // The refusal rule must produce an exact, deterministic response —
    // no disclaimers, no legal-advice preamble, no "I want to flag...".
    expect(out).toMatch(/The provided context does not address that/);
    // And it must NOT carry over the old legal-advice boilerplate
    // (the project dropped that rule — too lawyerly for a focused
    // Q&A tool).
    expect(out).not.toMatch(/legal advice/i);
  });

  it("requires citations to be inline, never paragraph headers", () => {
    const out = buildSystemPrompt([{ id: "x#1", text: "ctx", score: 0.9 }]);
    // The rules must say citations must be inline in the prose, not
    // a header before a paragraph. The phrasing in the rules uses
    // "inline" and forbids "From source [1]" as a header.
    expect(out).toMatch(/inline/i);
    expect(out).toMatch(/From source \[1\]/);
    // The rule must explicitly forbid starting a paragraph with [1].
    expect(out).toMatch(/Never start a new paragraph with/);
  });

  it("includes a positive inline-citation example", () => {
    const out = buildSystemPrompt([{ id: "x#1", text: "ctx", score: 0.9 }]);
    // The positive example must end a claim with [n] inside the sentence,
    // not as a header. We anchor on the "Article 6" phrasing because
    // that's the canonical example in the prompt.
    expect(out).toMatch(/An AI system is high-risk if it is a safety component of a product listed in Annex I \[\d+\]/);
  });

  it("includes a negative 'From source [1]' example marked INCORRECT", () => {
    const out = buildSystemPrompt([{ id: "x#1", text: "ctx", score: 0.9 }]);
    // The negative example must be present and explicitly marked
    // as the wrong way to cite. The word "Incorrect" must appear
    // somewhere near the "From source [1]" example so the model
    // learns the right rule.
    expect(out).toMatch(/Incorrect/);
    expect(out).toMatch(/From source \[1\]: Article 6/);
  });

  it("bounds citation density with per-claim variation guidance", () => {
    const out = buildSystemPrompt([{ id: "x#1", text: "ctx", score: 0.9 }]);
    // The prompt replaced the old "2 to 5 citations" rule with a
    // per-claim variation rule — the model picks a different source
    // for each claim rather than repeating [1] across a paragraph.
    expect(out).toMatch(/Vary citations/i);
  });

  it("few-shot example uses inline [n] markers in the prose, not headers", () => {
    const out = buildSystemPrompt([{ id: "x#1", text: "ctx", score: 0.9 }]);
    // Find the few-shot example block. The example uses
    // "Under Article 6..." and ends sentences with [n] markers.
    expect(out).toMatch(/Under Article 6/);
    expect(out).toMatch(/\[\d+\]\. The system must/);
    // And the example must NOT use the old "From source [n]:" pattern.
    expect(out).not.toMatch(/From source \[\d+\]: Under Article 6/);
  });

  it("explains the [n] marker maps to the n-th item in the rendered Sources list", () => {
    const out = buildSystemPrompt([{ id: "x#1", text: "ctx", score: 0.9 }]);
    // The Sources section must connect the inline [n] marker to
    // the n-th item the user sees (with its type label). Retrieval
    // scores are intentionally NOT shown to the user (see Source
    // type in api-contract.ts), so the prompt must not promise one.
    expect(out).toMatch(/correspond to the n-th item/);
    expect(out).not.toMatch(/relevance score/);
  });
});
