"use client"

/**
 * ChatContainer
 * ----------------------------------------------------------------------------
 * The full chat surface: header, transcript (or empty state), the
 * optional BrowseTheAct panel, and the composer. Owns the useChatState
 * hook so siblings don't have to know how the SDK is configured.
 *
 * Layout: a single column, centered, max-width capped at 2xl (672px).
 * This is the mastra.ai / Linear / Vercel pattern — one conversation,
 * one column.
 *
 * The BrowseTheAct panel sits in a "below the empty state, above the
 * composer" slot: it gives users a quick scan of the Act's structure
 * and a way to seed a query from any article title.
 * ----------------------------------------------------------------------------
 */
import { motion, AnimatePresence } from "framer-motion";
import * as React from "react";

import { BrowseTheAct } from "@/components/chat/BrowseTheAct";
import { ChatInput } from "@/components/chat/ChatInput";
import { EmptyState } from "@/components/chat/EmptyState";
import { MessageList } from "@/components/chat/MessageList";
import { Button } from "@/components/ui/button";
import { fadeInVariants } from "@/lib/motion";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";

import { useChatState } from "./hooks/useChatState";
import { SUGGESTED_QUESTIONS } from "./SuggestedQuestions";

export function ChatContainer() {
  const {
    messages,
    streamingMessageId,
    isStreaming,
    isInitialLoading,
    error,
    send,
    stop,
    reset,
    retry,
  } = useChatState();

  const hasMessages = messages.length > 0;

  const handleReset = React.useCallback(() => {
    log.info({ messageCount: messages.length }, "chat.reset");
    reset();
  }, [reset, messages.length]);

  return (
    <div className="flex h-full w-full flex-col">
      <Header onReset={hasMessages ? handleReset : undefined} />

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

        {!hasMessages ? (
          <BrowseTheAct onSelectArticle={send} />
        ) : null}

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
        <span className="text-sm font-medium tracking-tight">EU AI Act Expert</span>
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
      return "No relevant articles found";
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
