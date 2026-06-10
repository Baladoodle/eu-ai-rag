/**
 * /api/chat — STUB ROUTE
 * ----------------------------------------------------------------------------
 * THIS IS A STUB. The real route is owned by the api-agent (Phase 6) and
 * will be wired to the RAG retriever + Anthropic streaming. This stub
 * exists only so the UI can be developed and visually verified without
 * the backend being ready.
 *
 * It returns a canned, streamed response that includes a single
 * `data-sources` part — exercising the same UI message stream shape the
 * real route will produce. Replace this entire file in the integration
 * phase; do not extend it.
 * ----------------------------------------------------------------------------
 */
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { NextResponse } from "next/server";

import { log } from "@/lib/logger";

export const runtime = "edge";

interface StubCitation {
  index: number;
  source: {
    id: string;
    title: string;
    url: string;
    section?: string;
    snippet: string;
    fullText: string;
    score: number;
    retrievedAt: string;
  };
}

const STUB_CITATIONS: StubCitation[] = [
  {
    index: 1,
    source: {
      id: "mastra-docs/rag/overview#chunk-0",
      title: "Mastra RAG Overview",
      url: "https://mastra.ai/docs/rag/overview",
      section: "What is RAG",
      snippet:
        "Retrieval-Augmented Generation (RAG) is a pattern that grounds LLM responses in retrieved documents…",
      fullText:
        "Retrieval-Augmented Generation (RAG) is a pattern that grounds LLM responses in retrieved documents. Mastra provides first-class RAG primitives so you can move from a few prototype prompts to a production system without rebuilding the plumbing.",
      score: 0.92,
      retrievedAt: new Date().toISOString(),
    },
  },
  {
    index: 2,
    source: {
      id: "mastra-docs/rag/vector-databases#chunk-1",
      title: "Vector Databases",
      url: "https://mastra.ai/docs/rag/vector-databases",
      section: "pgvector",
      snippet:
        "Mastra ships an adapter for pgvector, the open-source vector store that lives inside Postgres…",
      fullText:
        "Mastra ships an adapter for pgvector, the open-source vector store that lives inside Postgres. Using pgvector means you can co-locate vectors with the rest of your application's data and avoid running a second database.",
      score: 0.87,
      retrievedAt: new Date().toISOString(),
    },
  },
];

const STUB_ANSWER =
  "Mastra's RAG module is the **core piece** for building grounded chat experiences. It bundles chunking, embedding, and a vector store adapter behind one consistent API [1]. The most common path in production is to use the `@mastra/pg` adapter with **pgvector** so your vectors live alongside the rest of your app data [2]. For local dev, you can swap in the in-memory backend and the same code keeps working — no API keys required.";

/**
 * Splits a string into small chunks so the streamed UI can be visually
 * verified to "type out" rather than arrive in one piece. 12ms per chunk
 * feels like a fast human typist and is well under the network round-trip.
 */
function chunked(text: string, size = 4) {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { messages?: unknown[]; sessionId?: string }
    | null;
  const sessionId = body?.sessionId ?? "anonymous";
  log.info({ sessionId, msgCount: body?.messages?.length ?? 0 }, "chat.stub.start");

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const messageId = `stub-${Date.now()}`;
      const textId = `${messageId}-text`;

      // 1) Open the message.
      writer.write({ type: "start", messageId });

      // 2) Open the text part and stream the canned answer token-by-token.
      writer.write({ type: "text-start", id: textId });
      const parts = chunked(STUB_ANSWER);
      for (const piece of parts) {
        writer.write({ type: "text-delta", id: textId, delta: piece });
        // Yield to the event loop so the client actually sees each delta.
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
      writer.write({ type: "text-end", id: textId });

      // 3) Emit the custom `data-sources` part.
      writer.write({
        type: "data-sources",
        id: `${messageId}-sources`,
        data: {
          citations: STUB_CITATIONS.map((c) => ({
            index: c.index,
            source: c.source,
          })),
          retrieval: {
            candidates: STUB_CITATIONS.length,
            finalCount: STUB_CITATIONS.length,
            topScore: STUB_CITATIONS[0]?.source.score ?? 0,
            latencyMs: 42,
            embeddingModel: "voyage-code-3 (stub)",
          },
        },
      });

      // 4) Close the message.
      writer.write({ type: "finish" });
    },
  });

  log.info({ sessionId }, "chat.stub.end");
  return createUIMessageStreamResponse({ stream });
}

// Reject anything other than POST with a clear error so the client doesn't
// silently no-op.
export function GET() {
  return NextResponse.json(
    { code: "METHOD_NOT_ALLOWED", message: "Use POST." },
    { status: 405 }
  );
}
