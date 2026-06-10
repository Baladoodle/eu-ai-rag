"use client"

/**
 * useChatState
 * ----------------------------------------------------------------------------
 * Thin wrapper over Vercel AI SDK's `useChat`. The wrapper:
 *   - Pins the API endpoint to `/api/chat` via a `DefaultChatTransport`.
 *   - Surfaces only the fields the UI cares about (id of the in-flight
 *     message, error code/message, retry callback) so consumers don't
 *     have to know the SDK's full return shape.
 *
 * Why a hook (not just calling useChat at the call site): the API
 * surface area we need is small and stable, and centralising it here
 * means swapping providers later is one file.
 *
 * Note: in AI SDK v6 the `api`/`body` props moved off `useChat` and onto
 * a `DefaultChatTransport`. We construct the transport here so callers
 * don't have to.
 * ----------------------------------------------------------------------------
 */
import { DefaultChatTransport, isDataUIPart, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import * as React from "react";

export type ChatErrorPayload = {
  code: string;
  message: string;
};

export interface UseChatStateResult {
  messages: UIMessage[];
  /** ID of the assistant message that is currently streaming, or null. */
  streamingMessageId: string | null;
  /** True while the SDK has a request in-flight. */
  isStreaming: boolean;
  /** True on the very first request (used for the initial "thinking" UI). */
  isInitialLoading: boolean;
  /** Latest `data-error` part seen on any message, or null. */
  error: ChatErrorPayload | null;
  /** Send a user prompt. */
  send: (text: string) => void;
  /** Abort the in-flight stream. */
  stop: () => void;
  /** Clear the conversation and any error. */
  reset: () => void;
  /** Convenience: re-send the last user message. */
  retry: () => void;
}

export function useChatState(): UseChatStateResult {
  // Generate a stable id per browser session so the backend can correlate
  // log lines. No PII, no auth — just a correlation key.
  const sessionIdRef = React.useRef<string | null>(null);
  if (sessionIdRef.current === null && typeof crypto !== "undefined") {
    sessionIdRef.current = crypto.randomUUID();
  }

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { sessionId: sessionIdRef.current ?? undefined },
      }),
    []
  );

  const chat = useChat({
    id: "mastra-expert-chat",
    transport,
    // Throttle the React re-renders a touch during heavy streams so the
    // caret animation isn't fighting text rendering. 50ms is imperceptible
    // but cuts re-renders by ~5x.
    experimental_throttle: 50,
  });

  const streamingMessageId = React.useMemo(() => {
    if (chat.status !== "streaming" && chat.status !== "submitted") return null;
    // The last message is the in-flight assistant one.
    const last = chat.messages[chat.messages.length - 1];
    return last?.role === "assistant" ? last.id : null;
  }, [chat.status, chat.messages]);

  // Walk the message list for the most recent `data-error` part. We don't
  // pop errors from the message — that would lose streaming state — we
  // just surface the latest one for the banner.
  const error = React.useMemo<ChatErrorPayload | null>(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const message = chat.messages[i];
      if (!message) continue;
      for (const part of message.parts) {
        if (isDataUIPart(part) && part.type === "data-error") {
          const data = part.data as { code?: string; message?: string };
          if (data.code && data.message) {
            return { code: data.code, message: data.message };
          }
        }
      }
    }
    return null;
  }, [chat.messages]);

  const isInitialLoading =
    chat.status === "submitted" && chat.messages.length === 0;

  const send = React.useCallback(
    (text: string) => {
      chat.sendMessage({ text });
    },
    [chat]
  );

  const reset = React.useCallback(() => {
    chat.setMessages([]);
  }, [chat]);

  const retry = React.useCallback(() => {
    // Find the last user message and re-send it.
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const m = chat.messages[i];
      if (m && m.role === "user") {
        const text = m.parts
          .filter((p) => p.type === "text")
          .map((p) => ("text" in p ? p.text : ""))
          .join("");
        if (text) {
          chat.sendMessage({ text });
          return;
        }
      }
    }
  }, [chat]);

  return {
    messages: chat.messages,
    streamingMessageId,
    isStreaming: chat.status === "streaming" || chat.status === "submitted",
    isInitialLoading,
    error,
    send,
    stop: chat.stop,
    reset,
    retry,
  };
}
