/**
 * tests/backend/generation.test.ts
 * ----------------------------------------------------------------------------
 * Unit tests for the generation step.
 *
 * Why these tests:
 *   Generation is the only RAG step that hits a paid API. We want
 *   to verify (a) it returns a `UIMessageStream`, (b) citations are
 *   built even when the model hasn't streamed yet, (c) credential
 *   checks short-circuit cleanly, (d) errors are logged with shape.
 *
 * How we mock:
 *   - We don't call the real Anthropic SDK.
 *   - We `vi.mock` `@/lib/anthropic` to return a fake model and a
 *     fake `streamText` that yields a trivial stream.
 * ----------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the AI SDK's `streamText` so we never make a real network call.
// We return a stub `toUIMessageStream` that yields a single text part.
const fakeToUIMessageStream = vi.fn(async function* () {
  yield { type: "text" as const, text: "stub" };
});

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: vi.fn(() => ({
      toUIMessageStream: fakeToUIMessageStream,
    })),
  };
});

// Mock the Anthropic client wrapper so we can assert on the model id.
vi.mock("@/lib/anthropic", () => ({
  getAnthropicModel: vi.fn(() => ({ modelId: "claude-sonnet-4-5" })),
  hasAnthropicCredentials: vi.fn(() => true),
}));

import { generate, canGenerate, toModelMessages, isMockMode } from "@/backend/rag/generation";
import type { RetrievedChunk } from "@/lib/vector-store-reader";

const chunks: RetrievedChunk[] = [
  { id: "x#1", text: "hello", score: 0.9 },
];

describe("generation", () => {
  beforeEach(() => {
    fakeToUIMessageStream.mockClear();
  });

  it("returns a stream, citations, and a modelId", async () => {
    const out = await generate({
      system: "you are a test",
      messages: [{ role: "user", content: "hi" }],
      chunks,
    });
    expect(out.modelId).toBe("claude-sonnet-4-5");
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0]?.index).toBe(1);
    // The stream should be async-iterable.
    const collected: unknown[] = [];
    for await (const part of out.stream) collected.push(part);
    expect(collected.length).toBeGreaterThan(0);
  });

  it("passes the system prompt and messages through to streamText", async () => {
    const { streamText } = await import("ai");
    const callsBefore = vi.mocked(streamText).mock.calls.length;
    await generate({
      system: "sys-xyz",
      messages: [{ role: "user", content: "hello" }],
      chunks,
    });
    const callsAfter = vi.mocked(streamText).mock.calls.length;
    expect(callsAfter).toBe(callsBefore + 1);
    const lastCall = vi.mocked(streamText).mock.calls.at(-1)?.[0] as
      | { system?: string; messages?: unknown }
      | undefined;
    expect(lastCall?.system).toBe("sys-xyz");
    expect(lastCall?.messages).toBeDefined();
  });

  it("uses a low temperature for factual accuracy", async () => {
    const { streamText } = await import("ai");
    await generate({
      system: "s",
      messages: [{ role: "user", content: "q" }],
      chunks,
    });
    const call = vi.mocked(streamText).mock.calls.at(-1)?.[0] as
      | { temperature?: number }
      | undefined;
    expect(call?.temperature).toBeLessThanOrEqual(0.3);
  });

  it("canGenerate reports missing credentials", async () => {
    const { hasAnthropicCredentials } = await import("@/lib/anthropic");
    (hasAnthropicCredentials as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const oldMock = process.env.MOCK;
    delete process.env.MOCK;
    const out = canGenerate();
    expect(out.ok).toBe(false);
    process.env.MOCK = oldMock;
  });

  it("canGenerate reports ok when credentials are present", () => {
    const out = canGenerate();
    expect(out.ok).toBe(true);
  });

  it("toModelMessages returns a defined value", () => {
    const out = toModelMessages([
      { id: "m1" as never, role: "user", parts: [{ type: "text", text: "hi" }], content: "hi" },
      { id: "m2" as never, role: "assistant", parts: [{ type: "text", text: "hello" }], content: "hello" },
    ]);
    expect(out).toBeDefined();
    // convertToModelMessages is an SDK helper that returns whatever
    // shape the LLM SDK expects (in this version: an opaque object).
    // We just need the function to be importable and not throw.
    expect(() => toModelMessages([
      { id: "x" as never, role: "user", parts: [{ type: "text", text: "y" }], content: "y" },
    ])).not.toThrow();
  });
});

/**
 * MOCK mode tests.
 *
 * Why a separate describe:
 *   These tests need the AI SDK's `streamText` NOT to be called
 *   (the whole point of MOCK is to skip Anthropic). We mock
 *   `hasAnthropicCredentials` to return `true` (the default) and
 *   set MOCK=1; the short-circuit must happen *before* the SDK call.
 */
describe("generation in MOCK=1 mode", () => {
  const originalMock = process.env.MOCK;

  beforeEach(() => {
    process.env.MOCK = "1";
    fakeToUIMessageStream.mockClear();
  });

  afterEach(() => {
    if (originalMock === undefined) delete process.env.MOCK;
    else process.env.MOCK = originalMock;
  });

  it("isMockMode reflects the env var", () => {
    expect(isMockMode()).toBe(true);
  });

  it("returns mock-local modelId and never calls the real streamText", async () => {
    const { streamText } = await import("ai");
    const callsBefore = vi.mocked(streamText).mock.calls.length;
    const out = await generate({
      system: "s",
      messages: [{ role: "user", content: "What is Article 5?" }],
      chunks: [
        { id: "a5#1", text: "Article 5 prohibits certain AI practices.", score: 0.9 },
        { id: "a6#1", text: "Article 6 covers classification rules.", score: 0.8 },
      ],
      query: "What is Article 5?",
    });
    expect(out.modelId).toBe("mock-local");
    const callsAfter = vi.mocked(streamText).mock.calls.length;
    expect(callsAfter).toBe(callsBefore);
  });

  it("emits a synthesized answer that references the user's question and [n] citations", async () => {
    const out = await generate({
      system: "s",
      messages: [{ role: "user", content: "What is Article 5?" }],
      chunks: [
        { id: "a5#1", text: "Article 5 prohibits certain AI practices.", score: 0.9 },
        { id: "a6#1", text: "Article 6 covers classification rules.", score: 0.8 },
      ],
      query: "What is Article 5?",
    });

    // Drain the stream into chunks.
    const chunks: unknown[] = [];
    for await (const part of out.stream) chunks.push(part);

    // Reassemble the text-delta parts into a single string.
    const text = chunks
      .map((c) => {
        if (c && typeof c === "object" && (c as { type?: string }).type === "text-delta") {
          return (c as { delta?: string }).delta ?? "";
        }
        return "";
      })
      .join("");

    // The answer should:
    //   - open with a framing sentence that references the user's question
    //   - cite each retrieved chunk by 1-based index, in chunk order
    //   - contain at least 2 inline [n] markers
    //   - NOT use the old "From source [n]:" paragraph-header pattern
    //   - mention MOCK mode somewhere
    expect(text).toMatch(/Based on the EU AI Act/);
    expect(text).toMatch(/What is Article 5\?/);
    expect(text).toMatch(/\[1\]/);
    expect(text).toMatch(/\[2\]/);
    // Inline: citations should appear in the same sentence as the claim,
    // not as a header before a paragraph.
    expect(text).not.toMatch(/From source \[\d+\]:/);
    // Citations should appear in [1] [2] order matching chunk order.
    const idx1 = text.indexOf("[1]");
    const idx2 = text.indexOf("[2]");
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(idx1);
    expect(text.toLowerCase()).toContain("mock");
  });

  it("opens the synthesized answer with a framing sentence", async () => {
    const out = await generate({
      system: "s",
      messages: [{ role: "user", content: "What is Article 5?" }],
      chunks: [
        { id: "a5#1", text: "Article 5 prohibits certain AI practices.", score: 0.9 },
        { id: "a6#1", text: "Article 6 covers classification rules.", score: 0.8 },
      ],
      query: "What is Article 5?",
    });
    const text = await drainText(out.stream);
    // The first non-whitespace line should be the framing opener.
    expect(text.trimStart().startsWith("Based on the EU AI Act")).toBe(true);
  });

  it("does not start a paragraph with 'From source ['", async () => {
    const out = await generate({
      system: "s",
      messages: [{ role: "user", content: "What is Article 5?" }],
      chunks: [
        { id: "a5#1", text: "Article 5 prohibits certain AI practices.", score: 0.9 },
        { id: "a6#1", text: "Article 6 covers classification rules.", score: 0.8 },
        { id: "a50#1", text: "Article 50 requires transparency for chatbots.", score: 0.7 },
      ],
      query: "What is Article 5?",
    });
    const text = await drainText(out.stream);
    // The old ugly pattern must be gone — no paragraph begins with
    // "From source [n]:". This is the central behavior change.
    expect(text).not.toMatch(/\nFrom source \[\d+\]:/);
    expect(text).not.toMatch(/^From source \[\d+\]:/);
  });

  it("contains at least 2 inline [n] markers in the synthesized answer", async () => {
    const out = await generate({
      system: "s",
      messages: [{ role: "user", content: "What is Article 5?" }],
      chunks: [
        { id: "a5#1", text: "Article 5 prohibits certain AI practices.", score: 0.9 },
        { id: "a6#1", text: "Article 6 covers classification rules.", score: 0.8 },
      ],
      query: "What is Article 5?",
    });
    const text = await drainText(out.stream);
    const matches = text.match(/\[\d+\]/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps [1] [2] [3] in chunk order in the synthesized answer", async () => {
    const out = await generate({
      system: "s",
      messages: [{ role: "user", content: "What is Article 5?" }],
      chunks: [
        { id: "a5#1", text: "Article 5 prohibits certain AI practices.", score: 0.9 },
        { id: "a6#1", text: "Article 6 covers classification rules.", score: 0.8 },
        { id: "a50#1", text: "Article 50 requires transparency for chatbots.", score: 0.7 },
      ],
      query: "What is Article 5?",
    });
    const text = await drainText(out.stream);
    // The first occurrence of [1] must come before the first
    // occurrence of [2], which must come before [3]. This is what
    // makes the inline citation chips line up with the prose.
    const idx1 = text.indexOf("[1]");
    const idx2 = text.indexOf("[2]");
    const idx3 = text.indexOf("[3]");
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });

  it("emits a sensible refusal when there are no chunks", async () => {
    const out = await generate({
      system: "s",
      messages: [{ role: "user", content: "anything" }],
      chunks: [],
      query: "anything",
    });
    const chunks: unknown[] = [];
    for await (const part of out.stream) chunks.push(part);
    const text = chunks
      .map((c) => {
        if (c && typeof c === "object" && (c as { type?: string }).type === "text-delta") {
          return (c as { delta?: string }).delta ?? "";
        }
        return "";
      })
      .join("");
    expect(text.toLowerCase()).toMatch(/couldn't find|rephrase/);
  });

  it("still builds citations from the retrieved chunks", async () => {
    const out = await generate({
      system: "s",
      messages: [{ role: "user", content: "q" }],
      chunks: [
        { id: "a5#1", text: "Article 5", score: 0.9 },
        { id: "a6#1", text: "Article 6", score: 0.8 },
      ],
      query: "q",
    });
    expect(out.citations).toHaveLength(2);
    expect(out.citations[0]?.index).toBe(1);
    expect(out.citations[1]?.index).toBe(2);
  });

  it("canGenerate is ok in MOCK mode even without credentials", async () => {
    const { hasAnthropicCredentials } = await import("@/lib/anthropic");
    (hasAnthropicCredentials as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const out = canGenerate();
    expect(out.ok).toBe(true);
  });
});

/**
 * Drain a UI message stream into a single plain-text string.
 *
 * Why a helper:
 *   Five tests in this file all need the same "iterate the stream,
 *   collect the text-delta deltas, join them" pattern. Inlining it
 *   five times obscures the actual assertions.
 */
async function drainText(stream: AsyncIterable<unknown>): Promise<string> {
  const parts: unknown[] = [];
  for await (const part of stream) parts.push(part);
  return parts
    .map((c) => {
      if (c && typeof c === "object" && (c as { type?: string }).type === "text-delta") {
        return (c as { delta?: string }).delta ?? "";
      }
      return "";
    })
    .join("");
}
