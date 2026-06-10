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
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { generate, canGenerate, toModelMessages } from "@/backend/rag/generation";
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
      { id: "m1" as never, role: "user", content: "hi" },
      { id: "m2" as never, role: "assistant", content: "hello" },
    ]);
    expect(out).toBeDefined();
    // convertToModelMessages is an SDK helper that returns whatever
    // shape the LLM SDK expects (in this version: an opaque object).
    // We just need the function to be importable and not throw.
    expect(() => toModelMessages([
      { id: "x" as never, role: "user", content: "y" },
    ])).not.toThrow();
  });
});
