/**
 * tests/backend/route.test.ts
 * ----------------------------------------------------------------------------
 * Integration-style tests for the /api/chat route.
 *
 * Why these tests:
 *   The route is the *only* place where HTTP and the RAG pipeline
 *   meet. A regression here would break the frontend even if every
 *   individual step passes its own test. We assert:
 *     - A valid request returns an SSE response.
 *     - The response stream contains a `data-sources` part.
 *     - Validation errors return 400 with a JSON body.
 *     - Missing user message returns 400.
 *     - Pipeline errors return 500 with a JSON body.
 *
 * How we mock:
 *   - The RAG pipeline is mocked via `vi.mock("@/backend/rag/pipeline")`.
 *   - The logger is left alone (its tests live in `tests/unit/logger.test.ts`).
 * ----------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ------------------------------------------------------------------

// Mock the pipeline so we never touch the real RAG stack.
vi.mock("@/backend/rag/pipeline", () => {
  // Return a stream shape that `createUIMessageStream` can forward.
  const fakeStream = (async function* () {
    yield { type: "text" as const, text: "hello" };
  })();
  return {
    runRagPipeline: vi.fn(async () => ({
      stream: fakeStream,
      retrieval: {
        chunks: [],
        metadata: {
          candidates: 0,
          finalCount: 0,
          topScore: 0,
          latencyMs: 0,
          embeddingModel: "voyage-code-3",
        },
        queryEmbedding: [],
      },
      citations: [
        {
          index: 1,
          source: {
            id: "x#1" as never,
            title: "Stub",
            url: "https://example.com",
            snippet: "stub snippet",
            fullText: "stub snippet",
            score: 0.9,
            retrievedAt: "2026-06-10T00:00:00.000Z",
          },
        },
      ],
      sources: [],
      prompt: { system: "sys", userMessage: "u" },
      modelId: "claude-sonnet-4-5",
    })),
  };
});

import { POST } from "@/backend/api/chat/route";
import { runRagPipeline } from "@/backend/rag/pipeline";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readStream(response: Response): Promise<unknown[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parts: unknown[] = [];
  // Drain the whole stream.
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) buffer += decoder.decode(value, { stream: true });
  }
  buffer += decoder.decode();
  // Try to parse each `data: ...` line as JSON. We don't assert on
  // exact framing here — that's the AI SDK's job — only that the
  // stream contains *something* parsable.
  for (const line of buffer.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      parts.push(JSON.parse(payload));
    } catch {
      // not JSON, ignore
    }
  }
  return parts;
}

describe("/api/chat route", () => {
  beforeEach(() => {
    (runRagPipeline as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it("returns an SSE Response with content-type text/event-stream", async () => {
    const req = makeRequest({
      messages: [{ id: "m1", role: "user", content: "hi" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
  });

  it("forwards a requestId header for log correlation", async () => {
    const req = makeRequest({
      messages: [{ id: "m1", role: "user", content: "hi" }],
    });
    const res = await POST(req);
    expect(res.headers.get("x-request-id")).toMatch(/^req_/);
  });

  it("calls the pipeline exactly once per request", async () => {
    const req = makeRequest({
      messages: [{ id: "m1", role: "user", content: "how do I use pgvector?" }],
    });
    await POST(req);
    expect(runRagPipeline).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 when the schema is invalid (empty messages array)", async () => {
    const req = makeRequest({ messages: [] });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when there is no user message in the history", async () => {
    const req = makeRequest({
      messages: [{ id: "m1", role: "assistant", content: "hi" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { message: string };
    expect(json.message).toMatch(/user message/);
  });

  it("returns 500 when the pipeline throws", async () => {
    (runRagPipeline as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        throw new Error("boom");
      },
    );
    const req = makeRequest({
      messages: [{ id: "m1", role: "user", content: "hi" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("INTERNAL");
  });

  it("stream contains at least one parsable chunk", async () => {
    const req = makeRequest({
      messages: [{ id: "m1", role: "user", content: "hi" }],
    });
    const res = await POST(req);
    const parts = await readStream(res);
    expect(parts.length).toBeGreaterThan(0);
  });

  it("stream includes a data-sources part with citations", async () => {
    const req = makeRequest({
      messages: [{ id: "m1", role: "user", content: "hi" }],
    });
    const res = await POST(req);
    const parts = await readStream(res);
    // The AI SDK serializes custom data parts as `data: <json>` lines.
    // The shape of the inner JSON is `{ type: "data-sources", data: { citations, retrieval } }`.
    const sources = parts.find(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        (p as { type?: string }).type === "data-sources",
    ) as { data?: { citations?: unknown[] } } | undefined;
    expect(sources).toBeDefined();
    expect(sources?.data?.citations?.length).toBeGreaterThan(0);
  });

  it("accepts an AI SDK v6 message with parts: [{type:'text',text}]", async () => {
    // The frontend's useChat (AI SDK v6) sends messages in this shape.
    // The route must accept it and forward the user's text to the pipeline.
    const req = makeRequest({
      messages: [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "What is Article 5?" }],
        },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    // The pipeline should have been called once, with the user's text
    // extracted from `parts` (not the missing `content` field).
    const calls = (runRagPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const arg = calls[0]?.[0] as { query?: string; messages?: Array<{ content?: string }> };
    expect(arg.query).toBe("What is Article 5?");
    // The normalized message must carry the text in `content` for the pipeline.
    expect(arg.messages?.[0]?.content).toBe("What is Article 5?");
  });

  it("accepts the legacy v1 {role, content} shape for backwards compat", async () => {
    const req = makeRequest({
      messages: [{ id: "m1", role: "user", content: "hello legacy" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const calls = (runRagPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const arg = calls[0]?.[0] as { query?: string };
    expect(arg.query).toBe("hello legacy");
  });

  it("returns 400 when the v6 message has empty parts and no content", async () => {
    const req = makeRequest({
      messages: [
        { id: "1", role: "user", parts: [] },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
