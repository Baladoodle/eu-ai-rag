"use client"

/**
 * Message
 * ----------------------------------------------------------------------------
 * Renders a single chat message (user OR assistant). User messages are
 * simple right-aligned bubbles; assistant messages are full-width blocks
 * with markdown body, optional streaming cursor, and the source citation
 * list once the stream finishes.
 *
 * Citation wiring:
 *   - The `Markdown` component renders inline `[n]` chips inside the
 *     assistant body. The chip is small, mono, and tinted by the
 *     citation's type on hover.
 *   - The `SourceList` shows the full card grid below the body. The
 *     card has a type stripe, a relevance bar, and an EUR-Lex link.
 *   - Clicking a chip OR a card sets the `activeIndex`; the
 *     `useCitationHighlighter` effect scrolls the matching card into
 *     view and a CSS animation pulses it.
 *   - Hovering a card sets `hoveredIndex`; the matching inline chips
 *     dim, so the user can see at a glance which citation is being
 *     inspected.
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
import {
  CitationChips,
  SourceList,
  parseCitation,
  type CitationKind,
} from "@/components/chat/SourceCitations";
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

/**
 * How long the [n] chip's matching card stays highlighted. Long enough
 * to read, short enough that the next interaction isn't blocked.
 */
const ACTIVE_CITATION_HIGHLIGHT_MS = 1600;

export function Message({ message, isStreaming = false, className }: MessageProps) {
  const isUser = message.role === "user";

  // Flatten the message into the data we render. We collect:
  //   - concatenated text (for markdown rendering)
  //   - citations from any `data-sources` part
  const { text, citations } = React.useMemo(() => extractMessageData(message), [message]);

  // The currently-highlighted citation index (1-based). Auto-clears
  // after a short pause so a stale highlight doesn't linger.
  const [activeCitation, setActiveCitation] = React.useState<number | null>(null);
  const clearTimerRef = React.useRef<number | null>(null);

  // Which card the user is currently hovering. Used to dim the
  // matching inline chips in the markdown body.
  const [hoveredCitation, setHoveredCitation] = React.useState<number | null>(null);

  const handleCitationSelect = React.useCallback((index: number) => {
    setActiveCitation(index);
    if (clearTimerRef.current != null) {
      window.clearTimeout(clearTimerRef.current);
    }
    clearTimerRef.current = window.setTimeout(() => {
      setActiveCitation(null);
    }, ACTIVE_CITATION_HIGHLIGHT_MS);
  }, []);

  // Cancel any pending clear on unmount so we don't setState on a dead
  // component (and so a still-streaming message that disappears doesn't
  // dangle a timer).
  React.useEffect(() => {
    return () => {
      if (clearTimerRef.current != null) {
        window.clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  // Pre-compute citation metadata so the Markdown component can render
  // inline chips with the right colour and tooltip per index.
  const citationKinds = React.useMemo<Record<number, CitationKind>>(() => {
    const map: Record<number, CitationKind> = {};
    for (const c of citations) map[c.index] = parseCitation(c).kind;
    return map;
  }, [citations]);

  const citationTitles = React.useMemo<Record<number, string>>(() => {
    const map: Record<number, string> = {};
    for (const c of citations) map[c.index] = parseCitation(c).label;
    return map;
  }, [citations]);

  // Indices of chips that should render dimmed. We dim every chip
  // except the one being hovered so the link between the card and the
  // body is unambiguous.
  const dimmedIndices = React.useMemo<number[] | undefined>(() => {
    if (hoveredCitation == null) return undefined;
    return citations.map((c) => c.index).filter((i) => i !== hoveredCitation);
  }, [hoveredCitation, citations]);

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
            <AssistantBody
              text={text}
              isStreaming={isStreaming}
              citationKinds={citationKinds}
              citationTitles={citationTitles}
              dimmedIndices={dimmedIndices}
              onCitationSelect={handleCitationSelect}
            />
          )}
        </div>

        {!isUser && citations.length > 0 ? (
          <div className="w-full">
            <CitationChips
              count={citations.length}
              kinds={citationKinds}
              onSelect={handleCitationSelect}
            />
            <SourceList
              citations={citations}
              activeIndex={activeCitation}
              hoveredIndex={hoveredCitation}
              onHoverIndexChange={setHoveredCitation}
            />
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
      {isUser ? <User className="size-3.5" /> : <EurLexMark />}
    </div>
  );
}

/**
 * A small abstract mark for the assistant: a stylised "E" / column glyph
 * that reads as a regulation doc, not a brand logo. Hand-drawn as a
 * single inline SVG so we don't pull an asset.
 */
function EurLexMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className="size-4"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M3 2v12M3 8h6M3 2h7M3 14h7"
        stroke="currentColor"
        strokeWidth="1.4"
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
interface AssistantBodyProps {
  text: string;
  isStreaming: boolean;
  citationKinds: Record<number, CitationKind>;
  citationTitles: Record<number, string>;
  dimmedIndices?: number[];
  onCitationSelect: (index: number) => void;
}

function AssistantBody({
  text,
  isStreaming,
  citationKinds,
  citationTitles,
  dimmedIndices,
  onCitationSelect,
}: AssistantBodyProps) {
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
      <Markdown
        citationKinds={citationKinds}
        citationTitles={citationTitles}
        dimmedIndices={dimmedIndices}
        onCitationSelect={onCitationSelect}
      >
        {text}
      </Markdown>
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
