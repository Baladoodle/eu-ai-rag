"use client"

/**
 * ChatContainer
 * ----------------------------------------------------------------------------
 * The full chat surface: header, transcript (or empty state), and composer.
 * Owns the useChatState hook so siblings don't have to know how the SDK
 * is configured.
 *
 * Layout: a single column, centered, max-width capped at 2xl (672px).
 * This is the mastra.ai / Linear / Vercel pattern — one conversation,
 * one column, no sidebars (v1).
 * ----------------------------------------------------------------------------
 */
import { motion, AnimatePresence } from "framer-motion";
import * as React from "react";

import { ChatInput } from "@/components/chat/ChatInput";
import { EmptyState } from "@/components/chat/EmptyState";
import { MessageList } from "@/components/chat/MessageList";
import { Button } from "@/components/ui/button";
import { fadeInVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { useChatState } from "./hooks/useChatState";

// 3-4 starter questions. Kept short, real-Mastra, and pointing at the
// parts of the docs that have the densest signal in our corpus.
const SUGGESTED_QUESTIONS = [
  { id: "rag-overview", text: "What is RAG in Mastra and how do I get started?" },
  { id: "pgvector", text: "How do I configure Mastra with pgvector?" },
  { id: "rerank", text: "How does reranking work, and when should I use it?" },
  { id: "embed", text: "How do I swap in a custom embedding model?" },
];

export function ChatContainer() {
  const {
    messages,
    streamingMessageId,
    isStreaming,
    isInitialLoading,
    error,
    send,
    stop,
    retry,
  } = useChatState();

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full w-full flex-col">
      <Header onReset={hasMessages ? () => location.reload() : undefined} />

      <main className="relative flex flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {hasMessages ? (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-1 flex-col overflow-hidden"
            >
              <MessageList
                messages={messages}
                streamingMessageId={streamingMessageId}
              />
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-1 flex-col overflow-hidden"
            >
              {isInitialLoading ? (
                <div className="flex flex-1 items-center justify-center">
                  <span className="text-sm text-muted-foreground">
                    Preparing your assistant…
                  </span>
                </div>
              ) : (
                <EmptyState
                  questions={SUGGESTED_QUESTIONS}
                  onSelect={send}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error ? (
            <ErrorBanner
              key={error.code}
              code={error.code}
              message={error.message}
              onRetry={retry}
            />
          ) : null}
        </AnimatePresence>

        <ChatInput
          onSubmit={send}
          onStop={stop}
          isStreaming={isStreaming}
        />
      </main>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------------

interface HeaderProps {
  onReset?: () => void;
}

function Header({ onReset }: HeaderProps) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center justify-between border-b border-border/40 bg-background/60 px-4 py-3",
        "backdrop-blur supports-[backdrop-filter]:bg-background/40"
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-6 items-center justify-center rounded-md border border-foreground/10 bg-foreground/5"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className="size-3.5"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M3 13V3l10 10V3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="text-sm font-medium tracking-tight">Mastra Expert</span>
      </div>

      {onReset ? (
        <Button
          type="button"
          onClick={onReset}
          variant="ghost"
          size="sm"
          aria-label="Start a new conversation"
        >
          New chat
        </Button>
      ) : null}
    </header>
  );
}

interface ErrorBannerProps {
  code: string;
  message: string;
  onRetry: () => void;
}

function ErrorBanner({ code, message, onRetry }: ErrorBannerProps) {
  return (
    <motion.div
      role="alert"
      initial="hidden"
      animate="visible"
      exit="hidden"
      variants={fadeInVariants}
      className="mx-auto w-full max-w-2xl px-4 pb-2"
    >
      <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-medium text-foreground">
            {humanizeErrorCode(code)}
          </span>
          <span className="text-muted-foreground">{message}</span>
        </div>
        <Button
          type="button"
          onClick={onRetry}
          variant="outline"
          size="sm"
          aria-label="Retry last message"
        >
          Retry
        </Button>
      </div>
    </motion.div>
  );
}

function humanizeErrorCode(code: string): string {
  switch (code) {
    case "RETRIEVAL_EMPTY":
      return "No relevant docs found";
    case "RETRIEVAL_LOW_CONFIDENCE":
      return "Low confidence answer";
    case "LLM_TIMEOUT":
      return "Assistant timed out";
    case "LLM_5XX":
      return "Assistant error";
    default:
      return "Something went wrong";
  }
}
