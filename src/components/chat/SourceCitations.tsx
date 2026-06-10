"use client"

/**
 * SourceCitations
 * ----------------------------------------------------------------------------
 * The expandable list of retrieved sources shown beneath each assistant
 * message. Numbered cards that open the canonical URL in a new tab on
 * click.
 *
 * Two concerns live in this file:
 *   1. CitationChips — the small `[1]` superscript-style references that
 *      appear inline in the markdown.
 *   2. SourceList — the card list that reveals after the message finishes
 *      streaming (animated by Framer Motion for polish).
 * ----------------------------------------------------------------------------
 */
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink } from "lucide-react";
import * as React from "react";

import { citationPanelVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { Citation } from "@/../api-contract";

// ----------------------------------------------------------------------------
// CitationChips — the `[1]` markers inside the assistant text.
// ----------------------------------------------------------------------------

interface CitationChipsProps {
  /** 1-based index of the highest citation in this message. */
  count: number;
  /**
   * Click handler. The Message component decides what to do — usually
   * scroll the source list into view and flash the matching card.
   */
  onSelect?: (index: number) => void;
  className?: string;
}

export function CitationChips({ count, onSelect, className }: CitationChipsProps) {
  if (count <= 0) return null;

  return (
    <span
      role="list"
      aria-label={`${count} citation${count === 1 ? "" : "s"}`}
      className={cn("ml-1 inline-flex items-center gap-1 align-baseline", className)}
    >
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="listitem"
          aria-label={`Jump to source ${n}`}
          onClick={() => onSelect?.(n)}
          className={cn(
            "inline-flex h-4 min-w-4 items-center justify-center rounded-md border border-border/60 bg-muted/50 px-1",
            "text-[10px] font-medium text-muted-foreground",
            "transition-colors hover:border-border hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          )}
        >
          {n}
        </button>
      ))}
    </span>
  );
}

// ----------------------------------------------------------------------------
// SourceList — the cards revealed under the message body.
// ----------------------------------------------------------------------------

interface SourceListProps {
  citations: Citation[];
  className?: string;
}

/**
 * Renders one source per row. Click anywhere on the card to open the
 * URL in a new tab. The whole row is the target — no nested <a>.
 *
 * Why: nested <a> elements are invalid HTML, and the entire card is
 * semantically "go to this source", so we make the whole thing a link
 * with a child icon.
 */
function SourceCard({ citation }: { citation: Citation }) {
  return (
    <a
      href={citation.source.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group flex items-start gap-3 rounded-lg border border-border/50 bg-card/30 p-3",
        "transition-colors hover:border-border hover:bg-card/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md",
          "border border-border/60 bg-muted/40 text-[10px] font-medium text-muted-foreground"
        )}
      >
        {citation.index}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground/90">
          <span className="truncate">{citation.source.title}</span>
          <ExternalLink
            aria-hidden="true"
            className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          />
        </span>
        {citation.source.section ? (
          <span className="truncate text-xs text-muted-foreground">
            {citation.source.section}
          </span>
        ) : null}
      </span>
    </a>
  );
}

export function SourceList({ citations, className }: SourceListProps) {
  return (
    <AnimatePresence initial={false}>
      {citations.length > 0 ? (
        <motion.section
          key="sources"
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={citationPanelVariants}
          aria-label="Sources"
          className={cn("mt-3 flex flex-col gap-2", className)}
        >
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Sources
          </span>
          <ul role="list" className="flex flex-col gap-1.5">
            {citations.map((citation) => (
              <li key={citation.source.id}>
                <SourceCard citation={citation} />
              </li>
            ))}
          </ul>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
