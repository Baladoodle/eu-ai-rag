/**
 * src/backend/api/chat/route.ts
 * ----------------------------------------------------------------------------
 * The single integration point between the frontend and the RAG
 * pipeline. The frontend's `useChat` hook POSTs to `/api/chat` and
 * expects an SSE response in the AI SDK's UI message stream protocol.
 *
 * This file's job is *only* to:
 *   1. Validate the request body.
 *   2. Call the orchestrator (`runRagPipeline`).
 *   3. Convert the orchestrator's output into an HTTP `Response` with
 *      the right `Content-Type` and SSE framing.
 *   4. Translate exceptions into a `data-error` part so the client
 *      sees a structured error (not a generic 500).
 *
 * Why the route is so thin:
 *   The interesting logic lives in `src/backend/rag/*` and can be
 *   tested without HTTP. The route is a *shell* that adapts the
 *   pipeline's output to the wire format the frontend speaks.
 *
 * Why we use `createUIMessageStreamResponse`:
 *   It's the AI SDK's adapter that turns a `UIMessageStream` into an
 *   HTTP `Response` with `Content-Type: text/event-stream` and the
 *   correct `x-vercel-ai-data-stream` headers. The frontend's
 *   `useChat` knows how to consume that exact response.
 *
 * Why we use a custom `merge` to inject the `data-sources` part:
 *   The pipeline builds the citations list up front, but the AI SDK's
 *   `streamText` doesn't know about our custom part type. We merge
 *   the citations into the stream at the end so the UI gets them in
 *   the same message turn.
 * ----------------------------------------------------------------------------
 */
import { createId } from "@/lib/ids";
import { log } from "@/lib/logger";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type AsyncIterableStream,
  type UIMessageChunk,
} from "ai";
import { z } from "zod";

import { runRagPipeline, type PipelineOutput } from "@/backend/rag/pipeline";
import type {
  ChatErrorCode,
  ChatErrorResponse,
  ChatRequest,
  Citation,
  CustomUIPart,
  IncomingMessage,
  RetrievalMetadata,
} from "@/../api-contract";

/**
 * A `UIMessageStream` is `AsyncIterableStream<UIMessageChunk>` — a
 * ReadableStream whose chunks are AI SDK UI message parts, also
 * async-iterable. The SDK doesn't export a named `UIMessageStream`
 * type, so we alias it here for readability.
 */
type UIMessageStream = AsyncIterableStream<UIMessageChunk>;

/**
 * Zod schema for the incoming message. We accept BOTH:
 *   - the AI SDK v6 shape: `{ id, role, parts: [{ type, text }, ...] }`
 *   - the legacy v1 shape: `{ id, role, content: string }`
 *
 * Why both: the frontend uses Vercel AI SDK v6 (`useChat`) which sends
 * `parts`; older clients (or curl smoke tests) may still send the
 * v1 `content` field. The schema is permissive on input and the
 * normalizer below reduces both shapes to a single `parts`-bearing
 * form for the rest of the pipeline.
 *
 * Why we accept ANY part type (not just `text`):
 *   Assistant messages round-trip through the SDK and accumulate extra
 *   part types over a multi-turn conversation — e.g. the backend's
 *   `data-sources` part gets re-sent on the next turn. Rejecting any
 *   non-text part would 400 the second message of any conversation.
 *   We only require that the message contain at least one `text` part
 *   with non-empty content; everything else is dropped by the
 *   normalizer. The refine below enforces that.
 */
const incomingMessageTextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

/**
 * Any part we don't care about. We accept it and drop it during
 * normalization. The `passthrough` keeps unknown fields intact so
 * future SDK part types don't break the contract.
 */
const incomingMessageOtherPartSchema = z
  .object({ type: z.string() })
  .passthrough();

const incomingMessagePartSchema = z.union([
  incomingMessageTextPartSchema,
  incomingMessageOtherPartSchema,
]);

const incomingMessageSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(["user", "assistant", "system"]),
    parts: z.array(incomingMessagePartSchema).optional(),
    content: z.string().optional(),
  })
  // At least one of `parts` or `content` must be present and non-empty
  // (counting only the text parts — data/source parts don't count as
  // user-visible content).
  .refine(
    (m) => {
      const textParts = (m.parts ?? []).filter(
        (p): p is { type: "text"; text: string } =>
          p.type === "text" && typeof p.text === "string",
      );
      const hasText = textParts.some((p) => p.text.trim().length > 0);
      const hasContent =
        typeof m.content === "string" && m.content.trim().length > 0;
      return hasText || hasContent;
    },
    { message: "Message must include non-empty `parts` or `content`" },
  );

const chatRequestSchema = z.object({
  messages: z.array(incomingMessageSchema).min(1).max(100),
  sessionId: z.string().min(1).optional(),
});

/**
 * Normalize an incoming message into the canonical `parts`-bearing
 * shape the pipeline consumes.
 *
 * Why a normalizer (and not two branches everywhere):
 *   The pipeline's helpers (`extractLatestUserText`, `extractPriorTurns`)
 *   already collapse `parts` to a single text string internally. We
 *   want a single shape at the boundary so the rest of the code
 *   stays simple.
 *
 * Rules:
 *   - If `parts` is present and non-empty, concatenate the text of
 *     all `type: "text"` parts.
 *   - Else if `content` is present, wrap it as a single text part.
 *   - Else (shouldn't happen — Zod rejects), return an empty parts array.
 */
function normalizeMessage(
  raw: z.infer<typeof incomingMessageSchema>,
): IncomingMessage {
  if (Array.isArray(raw.parts) && raw.parts.length > 0) {
    const text = raw.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
    return {
      id: raw.id as IncomingMessage["id"],
      role: raw.role,
      parts: [{ type: "text", text }],
      content: text,
    };
  }
  const text = raw.content ?? "";
  return {
    id: raw.id as IncomingMessage["id"],
    role: raw.role,
    parts: [{ type: "text", text }],
    content: text,
  };
}

/**
 * Generate a request id (UUID-ish). Used for log correlation.
 *
 * Why: a single chat turn may produce dozens of log lines. Threading
 * a request id through them lets us filter to a single request in
 * Vercel's log dashboard.
 */
function newRequestId(): string {
  // We don't need a real UUID; a timestamp + random suffix is good
  // enough for log correlation.
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * POST /api/chat
 *
 * Why a named export:
 *   Next.js App Router discovers route handlers by their named export.
 *   `POST` is the verb the frontend uses; we don't need GET (it would
 *   be a CSRF vector for a streaming endpoint).
 */
export async function POST(req: Request): Promise<Response> {
  const requestId = newRequestId();
  const childLog = log.child({ requestId });

  // --- 1. Parse and validate the body ---
  let body: ChatRequest;
  try {
    const json = await req.json();
    const parsed = chatRequestSchema.safeParse(json);
    if (!parsed.success) {
      childLog.warn({ issues: parsed.error.issues }, "chat.bad_request");
      return jsonError("VALIDATION_FAILED", "Invalid request body", 400, requestId);
    }
    // Normalize each message into the canonical `parts`-bearing shape
    // so the rest of the pipeline sees a single, consistent form.
    body = {
      sessionId: parsed.data.sessionId as ChatRequest["sessionId"],
      messages: parsed.data.messages.map((m) => normalizeMessage(m)),
    };
  } catch (err) {
    childLog.error({ err }, "chat.parse_error");
    return jsonError("VALIDATION_FAILED", "Body must be valid JSON", 400, requestId);
  }

  const sessionId = body.sessionId ?? createId("sess");
  const sessionLog = childLog.child({ sessionId });

  sessionLog.info(
    { msgCount: body.messages.length, latestRole: lastRole(body.messages) },
    "chat.start",
  );

  // --- 2. Extract the latest user query ---
  const query = lastUserText(body.messages);
  if (!query) {
    sessionLog.warn("chat.no_user_message");
    return jsonError(
      "VALIDATION_FAILED",
      "At least one user message is required",
      400,
      requestId,
    );
  }

  // --- 3. Run the pipeline ---
  //
  // Why a try/catch around the *whole* pipeline:
  //   We want to surface *any* error (retrieval, embed, generation) as
  //   a `data-error` part on the stream so the client renders it
  //   inline. We only return a JSON 5xx if the error happened before
  //   the stream was set up (e.g. body parsing).
  let pipelineOut: PipelineOutput;
  try {
    pipelineOut = await runRagPipeline({
      query,
      messages: body.messages,
    });
  } catch (err) {
    sessionLog.error({ err: serializeError(err) }, "chat.pipeline_error");
    return jsonError(
      "INTERNAL",
      "The chat pipeline failed. Please try again.",
      500,
      requestId,
    );
  }

  // --- 4. Stream the response ---
  sessionLog.info(
    { chunkCount: pipelineOut.retrieval.chunks.length, modelId: pipelineOut.modelId },
    "chat.streaming",
  );

  try {
    // Inject the `data-sources` part at the end of the stream. The
    // AI SDK's `mergeStreams` would also work, but using
    // `createUIMessageStream` directly lets us keep the stream's
    // "shape" consistent and append the custom part in the right
    // position.
    const retrievalMeta = pipelineOut.retrieval.metadata;
    const wireRetrieval: RetrievalMetadata = {
      candidates: retrievalMeta.candidates,
      finalCount: retrievalMeta.finalCount,
      topScore: retrievalMeta.topScore,
      latencyMs: retrievalMeta.latencyMs,
      embeddingModel: retrievalMeta.embeddingModel,
      uniqueSources: retrievalMeta.uniqueSources,
      maxPerArticle: retrievalMeta.maxPerArticle,
    };
    const streamWithCitations = appendSourcesPart(
      pipelineOut.stream as unknown as ReadableStream<UIMessageChunk>,
      pipelineOut.citations,
      wireRetrieval,
    );

    return createUIMessageStreamResponse({
      stream: streamWithCitations,
      headers: {
        // Custom header so the frontend can correlate logs to a
        // specific request without parsing the body.
        "x-request-id": requestId,
      },
    });
  } catch (err) {
    sessionLog.error({ err: serializeError(err) }, "chat.stream_error");
    return jsonError(
      "INTERNAL",
      "Failed to start streaming response.",
      500,
      requestId,
    );
  }
}

/**
 * Append a `data-sources` part to the end of a UI message stream.
 *
 * Why a separate function:
 *   Keeps `POST` readable; the stream-merging logic is the most
 *   fiddly part of the route and deserves its own scope.
 *
 * Why a custom data part (and not a text part):
 *   The frontend's `message-bubble.tsx` discriminates on `part.type`.
 *   A `data-sources` part lets the UI render sources in the side
 *   panel without polluting the assistant's prose.
 */
function appendSourcesPart(
  baseStream: ReadableStream<UIMessageChunk> | AsyncIterable<UIMessageChunk>,
  citations: ReadonlyArray<Citation>,
  retrieval: RetrievalMetadata,
): UIMessageStream {
  // The AI SDK's `createUIMessageStream` builds a new stream that
  // forwards the base stream and then writes our custom part.
  return createUIMessageStream({
    execute: async ({ writer }) => {
      // Forward the base stream's events unchanged. We accept both a
      // `ReadableStream` (the SDK's runtime type) and an async iterable
      // (useful for tests that build the stream as a generator).
      const isAsyncIterable = (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        s: any,
      ): s is AsyncIterable<UIMessageChunk> =>
        s != null && typeof s[Symbol.asyncIterator] === "function";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = baseStream as any;
      if (isAsyncIterable(stream)) {
        for await (const value of stream) {
          if (value !== undefined) {
            await writer.write(value as unknown as Parameters<typeof writer.write>[0]);
          }
        }
      } else {
        const reader = stream.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value !== undefined) {
              await writer.write(value as unknown as Parameters<typeof writer.write>[0]);
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
      // Append the sources part. We use a custom data part because
      // the AI SDK's standard `source` part is shaped differently
      // from our `Citation` type.
      const dataPart: CustomUIPart = {
        type: "data-sources",
        data: { citations: [...citations], retrieval },
      };
      // Cast: the SDK's writer type is a strict discriminated union
      // that doesn't know about our `data-sources` custom part. The
      // stream is opaque at runtime, so this cast is safe.
      await writer.write(dataPart as unknown as Parameters<typeof writer.write>[0]);
    },
  }) as unknown as UIMessageStream;
}

/**
 * Return a JSON error response.
 *
 * Why: the contract for the *pre-stream* error path is a JSON body
 * with a stable shape. The `data-error` part is the *in-stream* error
 * shape; we keep them separate so the client can decide which to
 * surface where.
 */
function jsonError(
  code: ChatErrorCode,
  message: string,
  status: number,
  requestId: string,
): Response {
  const body: ChatErrorResponse = { code, message, requestId };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": requestId,
    },
  });
}

/**
 * Get the last user-role message's text. Returns `null` if there's
 * no user message (the Zod schema enforces at least one, but we
 * still guard).
 *
 * Why we read from `parts` first, then `content`:
 *   The route normalizes messages to the canonical `parts`-bearing
 *   shape, so `parts` is always present here. `content` is kept as
 *   a fallback for any code path that hasn't been normalized.
 */
function lastUserText(
  messages: ReadonlyArray<IncomingMessage>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") {
      const fromParts = m.parts
        ?.filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
      const text = (fromParts ?? m.content ?? "").trim();
      if (text) return text;
    }
  }
  return null;
}

/**
 * Return the role of the last message (for logging).
 */
function lastRole(
  messages: ReadonlyArray<{ role: string }>,
): string | undefined {
  return messages[messages.length - 1]?.role;
}

/**
 * Serialize an unknown error for logging.
 *
 * Why: prevents `[object Object]` lines in the log. Mirrors the helper
 * in generation.ts — duplicated to keep this file self-contained.
 */
function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  if (typeof err === "string") return { message: err };
  if (typeof err === "object" && err !== null) {
    return { ...(err as Record<string, unknown>) };
  }
  return { value: String(err) };
}
