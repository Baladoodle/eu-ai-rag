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
 * ----------------------------------------------------------------------------
 */
import { Streamdown } from "streamdown";
import * as React from "react";

import { cn } from "@/lib/utils";

interface MarkdownProps {
  children: string;
  className?: string;
  /**
   * IDs of citations the current text references. When set, `[1]`, `[2]`
   * etc. become inline superscript chips (handled by SourceCitations).
   * The Message component is responsible for choosing that presentation
   * — here we just render the text as-is.
   */
  citationMode?: "plain" | "chips";
}

export function Markdown({ children, className }: MarkdownProps) {
  if (!children) return null;

  return (
    <div
      className={cn(
        "prose prose-sm max-w-none dark:prose-invert",
        // Mastra-inspired: tight, readable, no crazy color changes.
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-p:leading-relaxed prose-p:my-2",
        "prose-code:rounded-md prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-medium prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:border prose-pre:border-border/60 prose-pre:bg-card/50 prose-pre:shadow-none",
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
