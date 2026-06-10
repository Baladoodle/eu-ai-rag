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
 * ----------------------------------------------------------------------------
 */
import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

interface MarkdownProps {
  children: string;
  className?: string;
}

export function Markdown({ children, className }: MarkdownProps) {
  if (!children) return null;

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
      <Streamdown>{children}</Streamdown>
    </div>
  );
}
