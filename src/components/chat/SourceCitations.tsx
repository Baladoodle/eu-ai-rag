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
 *   1. CitationChips — the small superscript-style buttons that appear
 *      inline in the assistant markdown. The list rendered here is the
 *      "old" summary row at the bottom of the message; the inline chips
 *      in the body text are produced by the Markdown component (see
 *      `InlineCitationChip`).
 *   2. SourceList — the cards revealed after the message finishes
 *      streaming (animated by Framer Motion for polish). Each card opens
 *      the source URL AND an EUR-Lex deep link in a new tab.
 *
 * Card design: every source has a "type" (Article / Recital / Annex /
 * Commission) and a similarity score. The type drives a thin left stripe
 * in a type-specific colour, a small uppercase tag, and the colour of
 * the relevance bar at the bottom. The score drives the bar's WIDTH
 * (not its colour) so the relationship stays scannable: "long bar =
 * strong match, short bar = weak match". Bar colour always matches
 * the type accent so the visual grouping is intact.
 *
 * Order in the source list ALWAYS matches the [1] [2] [3] order in the
 * assistant text. We never physically reorder; the type stripe + label
 * are how the user scans by type without losing reading comprehension.
 * ----------------------------------------------------------------------------
 */
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ExternalLink } from "lucide-react";
import * as React from "react";

import { citationPanelVariants, duration, easeOut } from "@/lib/motion";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";

import type { Citation } from "@/../api-contract";

// ----------------------------------------------------------------------------
// Citation parsing & type system
// ----------------------------------------------------------------------------

/**
 * The "kind" of regulation entry. Drives colour, label, and stripe.
 *  - "article" — articles in the main body of the Act
 *  - "recital" — recitals (the "whereas" clauses)
 *  - "annex"   — annexes
 *  - "commission" — Commission guidance / non-binding publications
 *  - "other"   — fallback for anything we can't classify
 */
export type CitationKind = "article" | "recital" | "annex" | "commission" | "other";

export interface ParsedCitation {
  /** Discriminator for visuals and grouping. */
  kind: CitationKind;
  /** Article / Recital / Annex number, e.g. "6", "6(1)", "III". */
  number: string;
  /** Human-readable label, e.g. "Article 6(1)". */
  label: string;
  /** Short, uppercase label we show on the type tag. */
  typeLabel: string;
}

const ARTICLE_RE = /article\s+(\d+(?:\([^)]+\))?)/i;
const RECITAL_RE = /recital\s+(\d+)/i;
const ANNEX_RE = /annex\s+([ivxlcdm]+|\d+)/i;
const COMMISSION_RE = /commission|guidance|implementing\s+act|delegated\s+act/i;

export function parseCitation(citation: Citation): ParsedCitation {
  // Prefer the wire-pinned article number when the chunk metadata carries
  // it (set at ingestion time by scrapers/docs.ts). This removes the
  // load-bearing coincidence that the regex below used to match inside
  // `citation.source.id` — change the id format and the card would
  // silently degrade to `kind: "other"` without this pin.
  const pinnedArticleNumber = citation.source.articleNumber;
  if (pinnedArticleNumber) {
    return {
      kind: "article",
      number: pinnedArticleNumber,
      label: `Article ${pinnedArticleNumber}`,
      typeLabel: "Article",
    };
  }
  const haystack = `${citation.source.title} ${citation.source.section ?? ""} ${citation.source.id}`;
  const article = haystack.match(ARTICLE_RE);
  if (article?.[1]) {
    return { kind: "article", number: article[1], label: `Article ${article[1]}`, typeLabel: "Article" };
  }
  const recital = haystack.match(RECITAL_RE);
  if (recital?.[1]) {
    return { kind: "recital", number: recital[1], label: `Recital ${recital[1]}`, typeLabel: "Recital" };
  }
  const annex = haystack.match(ANNEX_RE);
  if (annex?.[1]) {
    return { kind: "annex", number: annex[1], label: `Annex ${annex[1]}`, typeLabel: "Annex" };
  }
  if (haystack.match(COMMISSION_RE)) {
    return { kind: "commission", number: "", label: citation.source.title, typeLabel: "Commission" };
  }
  return { kind: "other", number: "", label: citation.source.title, typeLabel: "Source" };
}

/**
 * oklch accent per type. The numbers are chosen to read as the four
 * "regulation colours" outlined in the brief: warm accent for articles
 * (the regulation's main body), muted blue for recitals, sage for
 * annexes, neutral for Commission guidance. "Other" gets the warm
 * primary so it never disappears.
 */
const TYPE_ACCENT_OKLCH: Record<CitationKind, string> = {
  article: "oklch(0.86 0.06 80)",     // warm ochre (matches --primary)
  recital: "oklch(0.7 0.05 230)",     // muted blue
  annex: "oklch(0.75 0.05 150)",      // sage
  commission: "oklch(0.78 0.012 80)", // warm neutral
  other: "oklch(0.86 0.06 80)",       // fall back to warm accent
};

/**
 * Public helper: the accent OKLCH string for a parsed citation. Used by
 * inline chips too so the chip + card always agree on colour.
 */
export function accentForKind(kind: CitationKind): string {
  return TYPE_ACCENT_OKLCH[kind];
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
// CitationChip — the small inline `[n]` marker.
// ----------------------------------------------------------------------------

interface CitationChipProps {
  /** 1-based index of the citation this chip represents. */
  index: number;
  /** Click handler — the parent (Message) handles scroll + highlight. */
  onSelect?: (index: number) => void;
  /** Type kind — drives the accent colour on hover. */
  kind: CitationKind;
  /** Optional tooltip / aria description. */
  title?: string;
  /** Dimmed state — true while a paired source card is being hovered. */
  dimmed?: boolean;
}

export function CitationChip({ index, onSelect, kind, title, dimmed = false }: CitationChipProps) {
  return (
    <motion.button
      type="button"
      data-citation-index={index}
      data-citation-kind={kind}
      aria-label={`Jump to source ${index}`}
      title={title}
      onClick={() => {
        log.info({ index, kind }, "citation.chip.click");
        onSelect?.(index);
      }}
      whileHover={{
        borderColor: accentForKind(kind),
        color: accentForKind(kind),
      }}
      whileFocus={{
        borderColor: accentForKind(kind),
        color: accentForKind(kind),
      }}
      animate={{ opacity: dimmed ? 0.4 : 1 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        // True inline element so the chip sits on the text baseline and
        // never forces a line break. We use `align-super` + `text-[0.7em]`
        // so the chip looks like a superscript footnote marker — small,
        // tight, and part of the line — rather than a 18px button that
        // would push the line box tall enough to wrap.
        "mx-0.5 inline cursor-pointer rounded border border-border/60 bg-muted/50 align-super",
        "font-mono text-[0.7em] font-medium text-muted-foreground tabular-nums leading-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      )}
    >
      <span className="px-1 py-px">{index}</span>
    </motion.button>
  );
}

// ----------------------------------------------------------------------------
interface CitationChipsProps {
  /**
   * The citations the model actually used. Why pass citations instead
   * of just a count: the displayed source cards can be sparse
   * (filtered to only the indices the model cited with `[N]`). The
   * chip strip should mirror that sparsity — rendering chip `2`
   * when no card `2` exists makes the click silently no-op.
   */
  citations: ReadonlyArray<Citation>;
  /** Called with the 1-based index when a chip is clicked. */
  onSelect?: (index: number) => void;
  /** Kinds per index (1-based), used to colour each chip. */
  kinds?: Record<number, CitationKind>;
}

export function CitationChips({ citations, onSelect, kinds }: CitationChipsProps) {
  if (citations.length === 0) return null;

  return (
    <span
      role="list"
      aria-label={`${citations.length} citation${citations.length === 1 ? "" : "s"}`}
      className="ml-1 inline-flex items-center gap-1 align-baseline"
    >
      {citations.map((c) => (
        <CitationChip
          key={c.index}
          index={c.index}
          kind={kinds?.[c.index] ?? "other"}
          onSelect={onSelect}
        />
      ))}
    </span>
  );
}

// ----------------------------------------------------------------------------
// SourceCard — one citation row.
// ----------------------------------------------------------------------------

interface SourceCardProps {
  citation: Citation;
  /** 1-based index in the source list (matches the chip). */
  index: number;
  /** Toggle highlight on the source card (e.g. when its chip is clicked). */
  active: boolean;
  /** Hover signal — when true, all matching inline chips dim. */
  hovered?: boolean;
  /** When the user hovers anywhere ON the card we tell the parent. */
  onHoverChange?: (hovered: boolean) => void;
}

function SourceCard({ citation, index, active, hovered = false, onHoverChange }: SourceCardProps) {
  const parsed = parseCitation(citation);
  const eur = eurLexHref(citation);
  const accent = accentForKind(parsed.kind);

  // The retrieval-confidence score was intentionally removed from the
  // wire shape (see `Source` in api-contract.ts). End users conflated
  // cosine similarity with answer correctness. The card now shows only
  // the article/recital/annex label and the EUR-Lex link.

  // Why compact by default, expand on click:
  //   A 10-source answer can produce 10 nearly-identical cards. With
  //   the snippet + EUR-Lex link + bar visible for each one, the
  //   sources list scrolls for ages. The compact row gives the user
  //   the headline (type + label + score) at a glance; the expand
  //   reveals the snippet + canonical link only when they want it.
  // When the chip in the assistant prose is clicked, `active` flips
  // true and we auto-expand so the content is visible immediately.
  const [userExpanded, setUserExpanded] = React.useState(false);
  // Latch the card open on chip click: the parent sets `active` for
  // ~3s (to drive the highlight pulse + scroll-into-view) and then
  // clears it. Without latching, the card would close itself the
  // moment the highlight fades. Once latched, the user can still
  // collapse it manually by clicking the header.
  //
  // We use the React 19 "previous-value" pattern to sync `active` →
  // `userExpanded` during render (not in an effect) so the latching
  // happens the same render the chip click lands, with no flicker.
  const [prevActive, setPrevActive] = React.useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (active) setUserExpanded(true);
  }
  const expanded = userExpanded || active;
  const toggleExpanded = React.useCallback(() => {
    setUserExpanded((prev) => !prev);
  }, []);

  return (
    <motion.article
      data-citation-id={citation.source.id}
      data-citation-index={index}
      data-citation-kind={parsed.kind}
      data-active={active ? "true" : undefined}
      data-hovered={hovered ? "true" : undefined}
      data-expanded={expanded ? "true" : undefined}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onFocus={() => onHoverChange?.(true)}
      onBlur={() => onHoverChange?.(false)}
      initial={false}
      animate={active ? "active" : hovered ? "hover" : "rest"}
      whileHover="hover"
      variants={{
        rest: {
          borderColor: "color-mix(in oklch, var(--border) 50%, transparent)",
          backgroundColor: "color-mix(in oklch, var(--card) 30%, transparent)",
        },
        hover: {
          borderColor: "color-mix(in oklch, var(--border) 100%, transparent)",
          backgroundColor: "color-mix(in oklch, var(--card) 60%, transparent)",
          transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
        },
        active: {
          borderColor: "color-mix(in oklch, var(--foreground) 30%, transparent)",
          backgroundColor: "color-mix(in oklch, var(--card) 70%, transparent)",
          transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
        },
      }}
      className={cn(
        "group relative overflow-hidden rounded-lg border",
        "focus-within:border-border"
      )}
    >
      {/*
       * Type stripe: a 3px left border coloured per type. Implemented
       * as an inline-block element instead of border-l so we can drive
       * its colour directly from a CSS variable without re-doing the
       * motion variants that animate borderColor for the hover/active
       * states.
       */}
      <span
        aria-hidden="true"
        style={{ backgroundColor: accent }}
        className="absolute inset-y-0 left-0 w-[3px]"
      />

      {/*
       * Header row (always visible). Click to toggle expand. The whole
       * row is a single button so keyboard users get the same affordance
       * as mouse / touch. The EUR-Lex deep link inside the expanded
       * panel stops propagation so the click doesn't collapse the card.
       */}
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        aria-controls={`citation-${index}-body`}
        className="flex w-full min-w-0 items-center gap-2.5 py-1.5 pl-4 pr-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold tabular-nums"
          style={{
            color: accent,
            backgroundColor: `color-mix(in oklch, ${accent} 14%, transparent)`,
            borderColor: `color-mix(in oklch, ${accent} 30%, transparent)`,
            borderWidth: "1px",
          }}
        >
          {index}
        </span>

        <span
          aria-hidden="true"
          className="shrink-0 rounded border px-1.5 py-px text-[9px] font-semibold uppercase tracking-widest"
          style={{
            color: accent,
            borderColor: `color-mix(in oklch, ${accent} 40%, transparent)`,
          }}
        >
          {parsed.typeLabel}
        </span>

        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold tracking-tight text-foreground/90 tabular-nums">
          {parsed.label}
        </span>

        {citation.source.section && parsed.kind === "article" ? (
          <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
            {citation.source.section}
          </span>
        ) : null}


        <motion.span
          aria-hidden="true"
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: duration.fast, ease: easeOut }}
          className="shrink-0 text-muted-foreground/70"
        >
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>

      {/*
       * Expanded body. AnimatePresence + height: auto via framer's
       * height transition (framer animates the actual height value, not
       * just opacity, so the layout shift stays smooth).
       */}
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="body"
            id={`citation-${index}-body`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 border-t border-border/40 px-4 py-2.5">
              <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
                {citation.source.snippet}
              </p>

              <motion.a
                href={eur}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${parsed.label} on EUR-Lex (canonical)`}
                onClick={(event) => event.stopPropagation()}
                whileHover={{
                  backgroundColor:
                    "color-mix(in oklch, var(--muted) 40%, transparent)",
                  color: "var(--foreground)",
                }}
                whileFocus={{
                  backgroundColor:
                    "color-mix(in oklch, var(--muted) 40%, transparent)",
                  color: "var(--foreground)",
                }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="inline-flex w-fit items-center gap-1 rounded border border-border/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                EUR-Lex
                <ExternalLink className="size-2.5" aria-hidden="true" />
              </motion.a>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
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
  /** Index of the hovered card (for chip dimming). 1-based, or null. */
  hoveredIndex?: number | null;
  /** Hover state setter — drives bidirectional dimming with chips. */
  onHoverIndexChange?: (index: number | null) => void;
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
      `[data-citation-index="${activeIndex}"]`
    );
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeIndex, containerRef]);
}

export function SourceList({
  citations,
  activeIndex = null,
  hoveredIndex = null,
  onHoverIndexChange,
  className,
}: SourceListProps) {
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
                  index={citation.index}
                  active={activeIndex === citation.index}
                  hovered={hoveredIndex === citation.index}
                  onHoverChange={(h) => onHoverIndexChange?.(h ? citation.index : null)}
                />
              </li>
            ))}
          </ul>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
