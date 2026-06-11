"use client"

/**
 * useChatState
 * ----------------------------------------------------------------------------
 * Thin wrapper over Vercel AI SDK's `useChat`. The wrapper:
 *   - Pins the API endpoint to `/api/chat` via a `DefaultChatTransport`.
 *   - Surfaces only the fields the UI cares about (id of the in-flight
 *     message, error code/message, retry callback) so consumers don't
 *     have to know the SDK's full return shape.
 *   - Exposes `loadMessages` so the chat history sidebar can swap in a
 *     stored conversation in one call.
 *
 * Why a hook (not just calling useChat at the call site): the API
 * surface area we need is small and stable, and centralising it here
 * means swapping providers later is one file.
 *
 * Note: in AI SDK v6 the `api`/`body` props moved off `useChat` and onto
 * a `DefaultChatTransport`. We construct the transport here so callers
 * don't have to.
 *
 * Why the SDK's `id` is a stable string and NOT the per-conversation
 * `chatId` prop:
 *   The SDK uses `id` as a key for its internal state (messages,
 *   stream state, request in-flight). Passing the user's chatId here
 *   would reset the SDK's state on every chat switch — so the
 *   `loadMessages` call on the OLD chat instance would be silently
 *   thrown away as the new (empty) chat mounts. Result: clicking a
 *   history row showed an empty chat. We keep a stable id for the SDK
 *   and let the parent drive chat switching explicitly via
 *   `loadMessages` from a useEffect that watches `chatId`.
 * ----------------------------------------------------------------------------
 */
import { DefaultChatTransport, isDataUIPart, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import * as React from "react";

import { log } from "@/lib/logger";

export type ChatErrorPayload = {
  code: string;
  message: string;
};

/**
 * Walk a message list backwards and return the most recent `data-error`
 * payload, or null if none. Why a free function (and not inline in the
 * hook): React Compiler's manual-memoization check requires the body
 * to be recognizable as a pure derivation of the inputs. Pulling the
 * walk out of the hook lets us use plain `useMemo` semantics without
 * fighting the compiler.
 */
function findLatestError(messages: ReadonlyArray<UIMessage>): ChatErrorPayload | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
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
}

export interface UseChatStateOptions {
  /**
   * The user's per-conversation id (used for history persistence).
   * NOT forwarded to the AI SDK (see file-level comment for why).
   */
  chatId?: string;
}

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
  /**
   * Replace the current messages wholesale. Used by the chat history
   * sidebar to load a stored conversation in one call. Does not trigger
   * a network request.
   */
  loadMessages: (messages: UIMessage[]) => void;
}

function makeSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Stable id for the AI SDK's useChat. Constant for the lifetime of
 * the session so the SDK's internal state (stream, message buffer)
 * survives chat switches. Chat switching happens via `loadMessages`,
 * not via a new SDK id.
 */
const SDK_CHAT_ID = "mastra-expert-chat";

export function useChatState(options: UseChatStateOptions = {}): UseChatStateResult {
  // Per-browser session id so backend logs can be correlated. Lazily
  // initialised in state so the first render has the id available
  // without touching the ref during render.
  const [sessionId] = React.useState<string>(makeSessionId);

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { sessionId },
      }),
    [sessionId]
  );

  const chat = useChat({
    id: SDK_CHAT_ID,
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
  const error = React.useMemo<ChatErrorPayload | null>(
    () => findLatestError(chat.messages),
    [chat.messages],
  );

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

  /**
   * Replace the live message list. We log the operation so it's
   * obvious in devtools when the sidebar is re-hydrating state.
   * The user's chatId is logged for traceability but is intentionally
   * not used as the SDK's id (see file-level comment).
   */
  const loadMessages = React.useCallback(
    (messages: UIMessage[]) => {
      log.info(
        { count: messages.length, chatId: options.chatId },
        "chat.state.load",
      );
      chat.setMessages(messages);
    },
    [chat, options.chatId],
  );

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
    loadMessages,
  };
}
