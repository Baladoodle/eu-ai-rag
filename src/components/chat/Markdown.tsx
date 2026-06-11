"use client"

/**
 * Markdown
 * ----------------------------------------------------------------------------
 * Streaming-safe markdown renderer. Uses `streamdown` because it was
 * designed for token-by-token AI output: it doesn't choke on partial
 * fences, partial bold markers, or unclosed code blocks.
 *
 * Why streamdown over react-markdown: react-markdown parses the full
 * string on every keystroke during a stream, which visibly jitters
 * the output. streamdown diffs and only re-parses the changed region.
 *
 * Regulation domain: this corpus is legal text, not code. We deliberately
 * keep the code block styling plain (no syntax highlighting, no language
 * pills) — highlighting legal text in a code-flavoured palette would
 * actively mislead. Pre blocks get a clean, single-style treatment.
 *
 * Inline citation chips: the assistant frequently emits tokens like
 * `Article 6(1) [1]` to anchor a claim to a source. We want those
 * `[1]` markers to render as small interactive chips, not as raw text.
 * We do that by pre-splitting the input on the citation pattern
 * (`[N]`, N >= 1) and rendering each plain-text segment through
 * Streamdown with a stable React key derived from the running index, so
 * streaming remains incremental and per-segment memoization keeps the
 * "smooth" feeling of the stream.
 * ----------------------------------------------------------------------------
 */
import { Streamdown } from "streamdown";

import { CitationChip, type CitationKind } from "@/components/chat/SourceCitations";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  children: string;
  className?: string;
  /**
   * Map of 1-based citation index -> parsed kind. Used to colour the
   * inline chip. Optional; falls back to "other" when missing.
   */
  citationKinds?: Record<number, CitationKind>;
  /**
   * Map of 1-based citation index -> tooltip / aria title for the chip.
   * Usually the citation's parsed label, e.g. "Article 6(1)".
   */
  citationTitles?: Record<number, string>;
  /**
   * Indices (1-based) that should render dimmed. Driven by source-card
   * hover so the bidirectional highlight stays in sync.
   */
  dimmedIndices?: number[];
  /** Click handler — scrolls + highlights the matching source card. */
  onCitationSelect?: (index: number) => void;
}

/**
 * Matches a citation token: `[N]` where N is one or more digits.
 * We deliberately do NOT match `[N]` inside a markdown link's link-text
 * (`[label](href)`) or image (`![alt](src)`). The pre-pass below handles
 * that exclusion.
 */
const CITATION_TOKEN_RE = /\[(\d+)\]/g;

/**
 * Split markdown into segments of two flavours: plain text and citation
 * tokens. We walk the string and skip:
 *   - `[N]` immediately preceded by `!` (markdown image)
 *   - `[N]` whose closing `]` is followed by `(` (start of a markdown
 *     link target, e.g. `[1](https://...)`)
 *
 * Streamdown's text diffs per segment, so the citation insertion does
 * not break streaming. Each segment is a single Streamdown call with a
 * stable key.
 */
interface Segment {
  kind: "text" | "citation";
  /** For text: the markdown source. For citation: the 1-based index. */
  value: string;
  /** For citation: the start offset of the token in the source. */
  offset?: number;
}

function splitMarkdownWithCitations(source: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  // Reset lastIndex defensively — RegExp objects with /g are stateful.
  CITATION_TOKEN_RE.lastIndex = 0;
  while ((match = CITATION_TOKEN_RE.exec(source)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const prev = start > 0 ? source[start - 1] : "";
    const next = end < source.length ? source[end] : "";

    // Skip images: `![label](href)`.
    if (prev === "!") continue;
    // Skip links: `[label](href)`.
    if (next === "(") continue;

    if (start > cursor) {
      segments.push({ kind: "text", value: source.slice(cursor, start) });
    }
    const index = Number.parseInt(match[1] ?? "0", 10);
    segments.push({ kind: "citation", value: String(index), offset: start });
    cursor = end;
  }

  if (cursor < source.length) {
    segments.push({ kind: "text", value: source.slice(cursor) });
  }

  return segments;
}

export function Markdown({
  children,
  className,
  citationKinds,
  citationTitles,
  dimmedIndices,
  onCitationSelect,
}: MarkdownProps) {
  if (!children) return null;

  const segments = splitMarkdownWithCitations(children);
  const dimmedSet = dimmedIndices ? new Set(dimmedIndices) : null;

  return (
    <div
      className={cn(
        "prose prose-sm max-w-none dark:prose-invert",
        // Regulation prose: tight, readable, restrained colour.
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-p:leading-relaxed prose-p:my-2",
        // Inline code stays useful for quoted legal section IDs (e.g.
        // "Article 6(1)") but we do not paint them with a heavy
        // developer-style background.
        "prose-code:rounded prose-code:bg-muted/60 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-mono prose-code:text-foreground/90 prose-code:before:content-none prose-code:after:content-none",
        // Pre block: clean, single-style. No syntax highlighting, no
        // language pills — this is legal text, not source code.
        "prose-pre:border prose-pre:border-border/60 prose-pre:bg-card/40 prose-pre:shadow-none prose-pre:text-sm prose-pre:leading-relaxed",
        "prose-a:text-foreground prose-a:underline prose-a:decoration-muted-foreground/50 prose-a:underline-offset-4 hover:prose-a:decoration-foreground",
        "prose-strong:text-foreground prose-strong:font-semibold",
        "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
        "prose-blockquote:border-l-2 prose-blockquote:border-border prose-blockquote:text-muted-foreground prose-blockquote:not-italic",
        "[&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        className
      )}
    >
      {segments.map((segment, i) => {
        if (segment.kind === "citation") {
          const index = Number.parseInt(segment.value, 10);
          return (
            <CitationChip
              key={`cite-${i}-${index}`}
              index={index}
              kind={citationKinds?.[index] ?? "other"}
              title={citationTitles?.[index]}
              dimmed={dimmedSet?.has(index) ?? false}
              onSelect={onCitationSelect}
            />
          );
        }
        return (
          <span key={`md-${i}`} className="contents">
            <Streamdown>{segment.value}</Streamdown>
          </span>
        );
      })}
    </div>
  );
}
