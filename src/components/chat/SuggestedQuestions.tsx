"use client"

/**
 * SuggestedQuestions
 * ----------------------------------------------------------------------------
 * Renders 3-4 starter questions as clickable chips. Clicking submits the
 * question immediately — the empty state has no composer context to
 * "fill", and the questions are vetted to be a useful default. The user
 * can always type their own question instead.
 *
 * The starter questions live here (not in ChatContainer) so the EmptyState
 * and the BrowseTheAct panel both import from one place and the
 * regulation-specific prompts stay next to the visual treatment.
 *
 * Layout: a 2x2 grid at all sizes. Four equal cards read as a balanced
 * quartet and never overflow the viewport. The grid auto-stretches so
 * cards in the same row share the same height.
 * ----------------------------------------------------------------------------
 */
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { chipVariants, messageListVariants } from "@/lib/motion";

export interface SuggestedQuestion {
  /** Stable id, e.g. "risk-classes". Used as the React key. */
  id: string;
  /** The text we display and insert into the composer. */
  text: string;
}

interface SuggestedQuestionsProps {
  questions: SuggestedQuestion[];
  /** Called when the user clicks a chip. Receives the question text. */
  onSelect: (text: string) => void;
  /** Optional className for the wrapping `<ul>`. */
  className?: string;
}

/**
 * 4 regulation-specific starter prompts. Chosen to cover the parts of
 * Regulation (EU) 2024/1689 with the densest signal in our corpus and the
 * most common first-time user questions.
 */
export const SUGGESTED_QUESTIONS: SuggestedQuestion[] = [
  { id: "risk-levels", text: "What are the four risk levels for AI systems?" },
  { id: "prohibited", text: "Which AI practices are prohibited under Article 5?" },
  { id: "provider-obligations", text: "What obligations apply to providers of high-risk AI?" },
  { id: "gpai", text: "What rules apply to general-purpose AI (GPAI) models?" },
];

export function SuggestedQuestions({
  questions,
  onSelect,
  className,
}: SuggestedQuestionsProps) {
  return (
    <motion.ul
      role="list"
      aria-label="Suggested questions"
      initial="hidden"
      animate="visible"
      variants={messageListVariants}
      className={cn(
        "grid w-full grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-2.5",
        className
      )}
    >
      {questions.map((question) => (
        <motion.li key={question.id} variants={chipVariants} className="h-full">
          {/*
           * Per CLAUDE.md: use Framer Motion for hover/focus state changes.
           * We drive border + background on whileHover/whileFocus so the
           * transition feels in-system with the message entry animation.
           */}
          <motion.button
            type="button"
            onClick={() => onSelect(question.text)}
            whileHover={{
              borderColor: "color-mix(in oklch, var(--border) 100%, transparent)",
              backgroundColor: "color-mix(in oklch, var(--card) 70%, transparent)",
            }}
            whileFocus={{
              borderColor: "color-mix(in oklch, var(--border) 100%, transparent)",
              backgroundColor: "color-mix(in oklch, var(--card) 70%, transparent)",
            }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "group flex h-full w-full items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/40 px-4 py-3.5 text-left text-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            )}
          >
            <span className="text-balance text-foreground/90">{question.text}</span>
            {/*
             * The arrow nudges on hover via Framer Motion (not CSS
             * transition-transform). Wrapped in a motion span so the
             * transform is GPU-friendly and in the same easing family.
             */}
            <motion.span
              aria-hidden="true"
              className="shrink-0 text-muted-foreground"
              whileHover={{ x: 2, y: -2 }}
            >
              <ArrowUpRight className="size-3.5" />
            </motion.span>
          </motion.button>
        </motion.li>
      ))}
    </motion.ul>
  );
}
