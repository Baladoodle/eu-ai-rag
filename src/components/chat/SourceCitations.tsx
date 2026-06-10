"use client"

/**
 * SourceCitations
 * ----------------------------------------------------------------------------
 * The expandable list of retrieved citations shown beneath each assistant
 * message. The list is regulation-aware: Article numbers are the
 * primary identifier (large, monospace), Recital numbers are secondary,
 * and the snippet scrolls if it's long.
 *
 * Two concerns live in this file:
 *   1. CitationChips — the small `[1]` superscript-style references that
 *      appear inline in the markdown. Clicking a chip scrolls to the
 *      matching SourceCard and briefly highlights it via `data-active`.
 *   2. SourceList — the card list that reveals after the message finishes
 *      streaming (animated by Framer Motion for polish). Each card opens
 *      the source URL AND an EUR-Lex deep link in a new tab.
 *
 * Citation selection: the parent (`Message`) renders CitationChips and
 * SourceList together and threads an `onSelect` handler through both,
 * keeping the chip → card wiring local to the message.
 * ----------------------------------------------------------------------------
 */
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink } from "lucide-react";
import * as React from "react";

import { citationPanelVariants } from "@/lib/motion";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";

import type { Citation } from "@/../api-contract";

// ----------------------------------------------------------------------------
// Citation parsing
// ----------------------------------------------------------------------------

/**
 * A citation as the user sees it. We extract the article/recital numbers
 * from the source title (or the chunk id) so we can render the article
 * number prominently and the recital number as a secondary line.
 *
 * The EU AI Act's canonical structure is "Article N", "Article N(M)",
 * and "Recital N" — and "Annex N" for the annexes. We try the title
 * first, then fall back to a suffix on the id, then to a generic label.
 */
export interface ParsedCitation {
  /** "article" | "recital" | "annex" | "other". */
  kind: "article" | "recital" | "annex" | "other";
  /** Article / Recital / Annex number, e.g. "6", "6(1)", "III". */
  number: string;
  /** Human-readable label, e.g. "Article 6(1)". */
  label: string;
}

const ARTICLE_RE = /article\s+(\d+(?:\([^)]+\))?)/i;
const RECITAL_RE = /recital\s+(\d+)/i;
const ANNEX_RE = /annex\s+([ivxlcdm]+|\d+)/i;

export function parseCitation(citation: Citation): ParsedCitation {
  const haystack = `${citation.source.title} ${citation.source.section ?? ""} ${citation.source.id}`;
  const article = haystack.match(ARTICLE_RE);
  if (article?.[1]) {
    return { kind: "article", number: article[1], label: `Article ${article[1]}` };
  }
  const recital = haystack.match(RECITAL_RE);
  if (recital?.[1]) {
    return { kind: "recital", number: recital[1], label: `Recital ${recital[1]}` };
  }
  const annex = haystack.match(ANNEX_RE);
  if (annex?.[1]) {
    return { kind: "annex", number: annex[1], label: `Annex ${annex[1]}` };
  }
  return { kind: "other", number: "", label: citation.source.title };
}

/**
 * Build a deep link to the corresponding article on EUR-Lex. We use the
 * CELEX number 32024R1689 (Regulation (EU) 2024/1689) and a fragment
 * pointing at the article heading. Falls back to the citation URL.
 */
export function eurLexHref(citation: Citation): string {
  const parsed = parseCitation(citation);
  if (parsed.kind === "article") {
    return `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689#art_${parsed.number.replace(/[^a-z0-9]+/gi, "_")}`;
  }
  if (parsed.kind === "recital") {
    return `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689#rjn_${parsed.number}`;
  }
  return "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689";
}

// ----------------------------------------------------------------------------
// CitationChips — the `[1]` markers inside the assistant text.
// ----------------------------------------------------------------------------

interface CitationChipsProps {
  /** 1-based index of the highest citation in this message. */
  count: number;
  /** Called with the 1-based index when a chip is clicked. */
  onSelect?: (index: number) => void;
}

export function CitationChips({ count, onSelect }: CitationChipsProps) {
  if (count <= 0) return null;

  return (
    <span
      role="list"
      aria-label={`${count} citation${count === 1 ? "" : "s"}`}
      className="ml-1 inline-flex items-center gap-1 align-baseline"
    >
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="listitem"
          aria-label={`Jump to source ${n}`}
          onClick={() => {
            log.info({ index: n }, "citation.chip.click");
            onSelect?.(n);
          }}
          className={cn(
            "inline-flex h-4 min-w-4 cursor-pointer items-center justify-center rounded-md border border-border/60 bg-muted/50 px-1 align-baseline",
            "text-[10px] font-medium text-muted-foreground tabular-nums",
            "transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground",
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
// SourceCard — one citation row, regulation-aware layout.
// ----------------------------------------------------------------------------

interface SourceCardProps {
  citation: Citation;
  /** Toggle highlight on the source card (e.g. when its chip is clicked). */
  active: boolean;
}

function SourceCard({ citation, active }: SourceCardProps) {
  const parsed = parseCitation(citation);
  const eur = eurLexHref(citation);

  return (
    <article
      data-citation-id={citation.source.id}
      data-active={active ? "true" : undefined}
      className={cn(
        "group flex items-stretch overflow-hidden rounded-lg border border-border/50 bg-card/30",
        "transition-colors duration-200 hover:border-border hover:bg-card/60",
        "focus-within:border-border focus-within:bg-card/60",
        "data-[active=true]:border-foreground/30 data-[active=true]:bg-card/70"
      )}
    >
      <a
        href={citation.source.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${parsed.label} on EUR-Lex`}
        className={cn(
          "flex flex-1 items-start gap-3 p-3",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md",
            "border border-border/60 bg-muted/40 text-[10px] font-medium text-muted-foreground tabular-nums"
          )}
        >
          {citation.index}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={cn(
                "font-mono text-base font-semibold leading-none tracking-tight text-foreground",
                parsed.kind === "recital" && "text-sm font-medium text-muted-foreground",
                parsed.kind === "annex" && "text-sm font-medium text-muted-foreground"
              )}
            >
              {parsed.label}
            </span>
            {parsed.kind === "article" && citation.source.section ? (
              <span className="truncate text-xs text-muted-foreground">
                {citation.source.section}
              </span>
            ) : null}
          </span>
          {parsed.kind !== "recital" ? (
            <span className="max-h-16 overflow-y-auto text-pretty text-xs leading-relaxed text-muted-foreground">
              {citation.source.snippet}
            </span>
          ) : null}
        </span>
        <ExternalLink
          aria-hidden="true"
          className="mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
        />
      </a>
      <a
        href={eur}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${parsed.label} on EUR-Lex (canonical)`}
        className={cn(
          "flex shrink-0 items-center justify-center border-l border-border/40 px-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground",
          "transition-colors hover:bg-muted/40 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        )}
      >
        EUR-Lex
      </a>
    </article>
  );
}

// ----------------------------------------------------------------------------
// SourceList — the cards revealed under the message body.
// ----------------------------------------------------------------------------

interface SourceListProps {
  citations: Citation[];
  /**
   * Index of the citation to highlight (1-based). When the value changes,
   * we scroll the matching card into view and clear the highlight after
   * a short pause.
   */
  activeIndex?: number | null;
  className?: string;
}

/**
 * Highlights an active citation card, scrolls it into view, then clears
 * the highlight. Split out so the effect lives at the list level (where
 * we can iterate over cards) rather than the parent.
 */
function useCitationHighlighter(
  containerRef: React.RefObject<HTMLUListElement | null>,
  activeIndex: number | null
) {
  React.useEffect(() => {
    if (activeIndex == null) return;
    const container = containerRef.current;
    if (!container) return;
    const card = container.querySelector<HTMLElement>(
      `[data-citation-id]:nth-of-type(${activeIndex})`
    );
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeIndex, containerRef]);
}

export function SourceList({ citations, activeIndex = null, className }: SourceListProps) {
  const containerRef = React.useRef<HTMLUListElement | null>(null);
  useCitationHighlighter(containerRef, activeIndex);

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
          <ul ref={containerRef} role="list" className="flex flex-col gap-1.5">
            {citations.map((citation) => (
              <li key={citation.source.id}>
                <SourceCard
                  citation={citation}
                  active={activeIndex === citation.index}
                />
              </li>
            ))}
          </ul>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
