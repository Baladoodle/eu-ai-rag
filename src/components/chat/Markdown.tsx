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
 *
 *   Approach (post-render DOM walk, not text segmentation):
 *     The text segmentation approach (split the source on `[N]`,
 *     render each plain-text fragment through Streamdown, intersperse
 *     chip buttons) was tried and rejected. Streamdown parses each
 *     fragment independently, so a markdown *list* that crosses a
 *     citation boundary ends up as multiple single-item lists. The
 *     `1. **Unacceptable risk** ... [1]` pattern produced
 *     "1. Unacceptable risk" + (citation button) + ". 2. High risk"
 *     with each numbered item in its own `<ol>`.
 *
 *   The fix: render the FULL text through Streamdown once (so
 *   markdown structure is intact), then walk the resulting DOM in
 *   `useLayoutEffect` and replace every text node containing `[N]`
 *   with a `CitationChip` button. The markdown structure survives
 *   because the text-walk runs *after* parsing, and the chips are
 *   inline elements that fit naturally inside paragraphs, list
 *   items, etc.
 *
 *   Why not a remark plugin: Streamdown is the streaming-safe
 *   variant of react-markdown, but its plugin surface is opaque.
 *   DOM post-processing is more direct and easy to reason about.
 *
 *   Why `useLayoutEffect` not `useEffect`: we want the chips in
 *   place before the user sees the text, otherwise the `[1]`
 *   literal flashes for a frame.
 * ----------------------------------------------------------------------------
 */
import * as React from "react";
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
 *
 * We deliberately do NOT match `[N]` inside a markdown link's link-text
 * (`[label](href)`) or image (`![alt](src)`). The DOM walk below
 * checks the surrounding characters and skips those.
 */
const CITATION_TOKEN_RE = /\[(\d+)\]/g;

/**
 * Marker we set on text nodes we've already replaced, so a
 * re-render of the same `children` text doesn't double-replace
 * inside a still-streaming fragment.
 */
const PROCESSED_ATTR = "data-citation-processed";

export function Markdown({
  children,
  className,
  citationKinds,
  citationTitles,
  dimmedIndices,
  onCitationSelect,
}: MarkdownProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const dimmedSet = React.useMemo(
    () => (dimmedIndices ? new Set(dimmedIndices) : null),
    [dimmedIndices],
  );

  // Walk the rendered DOM and replace `[N]` text nodes with
  // CitationChip buttons. Runs in useLayoutEffect so the chips are
  // present before paint, and the marker attribute guards against
  // re-processing on every re-render.
  React.useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      if (
        node.parentElement?.getAttribute(PROCESSED_ATTR) === "true" ||
        // Don't touch nodes inside our already-injected chips.
        node.parentElement?.closest(`[data-citation-chip="true"]`)
      ) {
        node = walker.nextNode() as Text | null;
        continue;
      }
      if (CITATION_TOKEN_RE.test(node.nodeValue ?? "")) {
        textNodes.push(node);
        // Reset lastIndex defensively — /g regexes are stateful.
        CITATION_TOKEN_RE.lastIndex = 0;
      }
      node = walker.nextNode() as Text | null;
    }

    for (const textNode of textNodes) {
      const value = textNode.nodeValue ?? "";
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      let match: RegExpExecArray | null;
      // Fresh regex for each text node to avoid shared lastIndex bugs.
      const re = /\[(\d+)\]/g;
      while ((match = re.exec(value)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const prev = start > 0 ? value[start - 1] : "";
        const next = end < value.length ? value[end] : "";

        // Skip images: `![label](href)`.
        if (prev === "!") continue;
        // Skip links: `[label](href)`.
        if (next === "(") continue;

        if (start > cursor) {
          fragment.appendChild(
            document.createTextNode(value.slice(cursor, start)),
          );
        }
        const index = Number.parseInt(match[1] ?? "0", 10);
        const chip = makeChipElement({
          index,
          kind: citationKinds?.[index] ?? "other",
          title: citationTitles?.[index],
          dimmed: dimmedSet?.has(index) ?? false,
          onSelect: onCitationSelect,
        });
        fragment.appendChild(chip);
        cursor = end;
      }
      if (cursor < value.length) {
        fragment.appendChild(document.createTextNode(value.slice(cursor)));
      }
      // Only replace if we actually found a citation to swap.
      if (fragment.childNodes.length > 0) {
        textNode.parentNode?.replaceChild(fragment, textNode);
      }
    }
  }, [children, citationKinds, citationTitles, dimmedSet, onCitationSelect]);

  if (!children) return null;

  return (
    <div
      ref={containerRef}
      className={cn(
        // The `prose-*` Tailwind classes assume the typography plugin
        // is loaded — it isn't (we don't ship @tailwindcss/typography
        // as a dep). We duplicate the subset of typography styles we
        // actually use here, in vanilla Tailwind utilities, so the
        // Streamdown-rendered markdown looks like prose without
        // pulling in another package.
        "text-sm leading-relaxed text-foreground",
        // Headings (unlikely from a RAG answer but defensive).
        "[&_h1]:mt-3 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:tracking-tight",
        "[&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight",
        "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
        // Paragraphs.
        "[&_p]:my-2 [&_p]:leading-relaxed",
        // Inline code (used for Article numbers like `Article 6(1)`).
        "[&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_code]:font-mono [&_code]:text-foreground/90",
        // Code blocks: clean, no syntax highlighting.
        "[&_pre]:my-3 [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border/60 [&_pre]:bg-card/40 [&_pre]:p-4 [&_pre]:text-sm [&_pre]:leading-relaxed",
        // Links.
        "[&_a]:text-foreground [&_a]:underline [&_a]:decoration-muted-foreground/50 [&_a]:underline-offset-4 [&_a:hover]:decoration-foreground",
        // Bold and italic.
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_em]:italic",
        // Lists — the critical part. Streamdown emits `list-inside`
        // `list-decimal` etc. by default, but we override to get
        // tighter, regulation-flavoured spacing.
        "[&_ul]:my-2 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-0.5",
        "[&_ol]:my-2 [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-0.5",
        "[&_li]:my-0.5 [&_li]:leading-relaxed",
        // Blockquote.
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:not-italic",
        // First/last child spacing.
        "[&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        className
      )}
    >
      <Streamdown>{children}</Streamdown>
    </div>
  );
}

/**
 * Build a DOM element that visually matches the React-rendered
 * <CitationChip>. We construct it imperatively (instead of rendering
 * a React tree through a portal) so we don't have to worry about
 * React reconciliation overwriting our injected nodes on re-render.
 */
function makeChipElement(args: {
  index: number;
  kind: CitationKind;
  title: string | undefined;
  dimmed: boolean;
  onSelect: ((index: number) => void) | undefined;
}): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("data-citation-index", String(args.index));
  btn.setAttribute("data-citation-kind", args.kind);
  btn.setAttribute("data-citation-chip", "true");
  // Marker so the next render's DOM walk skips us.
  btn.setAttribute(PROCESSED_ATTR, "true");
  btn.setAttribute("aria-label", `Jump to source ${args.index}`);
  if (args.title) btn.setAttribute("title", args.title);

  btn.className = cn(
    "mx-0.5 inline cursor-pointer rounded border border-border/60 bg-muted/50 align-super",
    "font-mono text-[0.7em] font-medium text-muted-foreground tabular-nums leading-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  );
  if (args.dimmed) btn.style.opacity = "0.4";

  const inner = document.createElement("span");
  inner.className = "px-1 py-px";
  inner.textContent = String(args.index);
  btn.appendChild(inner);

  btn.addEventListener("click", () => {
    args.onSelect?.(args.index);
  });

  return btn;
}
