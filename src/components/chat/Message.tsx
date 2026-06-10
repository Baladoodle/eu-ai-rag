"use client"

/**
 * Message
 * ----------------------------------------------------------------------------
 * Renders a single chat message (user OR assistant). User messages are
 * simple right-aligned bubbles; assistant messages are full-width blocks
 * with markdown body, optional streaming cursor, and the source citation
 * list once the stream finishes.
 *
 * The streaming cursor is part of the assistant message — a thin
 * inline caret that fades in/out as tokens arrive. We keep the visual
 * "weight" of the message low: no card backgrounds for assistant
 * messages, just typography. The user bubble has the only fill, which
 * creates the visual distinction we want.
 * ----------------------------------------------------------------------------
 */
import { isDataUIPart, isTextUIPart, type UIMessage } from "ai";
import { motion } from "framer-motion";
import { User } from "lucide-react";
import * as React from "react";

import { LoadingIndicator } from "@/components/chat/LoadingIndicator";
import { Markdown } from "@/components/chat/Markdown";
import { SourceList, CitationChips } from "@/components/chat/SourceCitations";
import { messageVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { Citation } from "@/../api-contract";

interface MessageProps {
  message: UIMessage;
  /**
   * True while the parent is still streaming THIS message. We use it to
   * show the in-message caret on the last text part.
   */
  isStreaming?: boolean;
  className?: string;
}

export function Message({ message, isStreaming = false, className }: MessageProps) {
  const isUser = message.role === "user";

  // Flatten the message into the data we render. We collect:
  //   - concatenated text (for markdown rendering)
  //   - citations from any `data-sources` part
  const { text, citations } = React.useMemo(() => extractMessageData(message), [message]);

  return (
    <motion.article
      role="article"
      aria-label={isUser ? "Your message" : "Assistant message"}
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      className={cn(
        "flex w-full gap-3 sm:gap-4",
        isUser ? "flex-row-reverse" : "flex-row",
        className
      )}
    >
      <Avatar role={message.role} />

      <div
        className={cn(
          "flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[75%]",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-transparent text-foreground"
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{text}</p>
          ) : (
            <AssistantBody text={text} isStreaming={isStreaming} />
          )}
        </div>

        {!isUser && citations.length > 0 ? (
          <div className="w-full">
            <CitationChips count={citations.length} />
            <SourceList citations={citations} />
          </div>
        ) : null}
      </div>
    </motion.article>
  );
}

// ----------------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------------

function Avatar({ role }: { role: UIMessage["role"] }) {
  const isUser = role === "user";

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full border sm:size-8",
        isUser
          ? "border-border/60 bg-card text-muted-foreground"
          : "border-foreground/10 bg-foreground/5 text-foreground"
      )}
    >
      {isUser ? <User className="size-3.5" /> : <MastraMark />}
    </div>
  );
}

/**
 * The Mastra "M" mark, hand-drawn as a single inline SVG so we don't pull
 * a logo file. Abstract enough to read as a brand mark, simple enough to
 * stay minimal.
 */
function MastraMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className="size-4"
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
  );
}

/**
 * The assistant body is markdown plus, while streaming, a blinking caret
 * glued to the end of the rendered text. The caret is a real DOM element
 * (not a CSS pseudo-element) so we can animate its opacity with Framer.
 */
function AssistantBody({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const showInitialLoader = isStreaming && text.length === 0;

  if (showInitialLoader) {
    return (
      <div className="py-1">
        <LoadingIndicator />
      </div>
    );
  }

  return (
    <div className="relative">
      <Markdown>{text}</Markdown>
      {isStreaming ? <StreamingCaret /> : null}
    </div>
  );
}

function StreamingCaret() {
  return (
    <motion.span
      aria-hidden="true"
      className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 rounded-full bg-foreground/70 align-middle"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", times: [0, 0.2, 0.8, 1] }}
    />
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

interface ExtractedMessage {
  text: string;
  citations: Citation[];
}

/**
 * Walk the message parts, concatenating text parts and pulling citations
 * from any `data-sources` part.
 *
 * We don't render every part type — `step-start`, `source-url`, etc. are
 * irrelevant for the v1 RAG chat. We just defensively skip unknown parts.
 */
function extractMessageData(message: UIMessage): ExtractedMessage {
  const textParts: string[] = [];
  const citations: Citation[] = [];

  for (const part of message.parts) {
    if (isTextUIPart(part)) {
      textParts.push(part.text);
    } else if (isDataUIPart(part) && part.type === "data-sources") {
      const data = part.data as { citations?: Citation[] };
      if (Array.isArray(data.citations)) {
        citations.push(...data.citations);
      }
    }
  }

  return { text: textParts.join(""), citations };
}
