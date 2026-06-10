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
        "flex w-full flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:justify-center",
        className
      )}
    >
      {questions.map((question) => (
        <motion.li
          key={question.id}
          variants={chipVariants}
          className="sm:max-w-[280px] sm:flex-1"
        >
          <button
            type="button"
            onClick={() => onSelect(question.text)}
            className={cn(
              "group flex w-full items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-left text-sm",
              "transition-colors hover:border-border hover:bg-card/70",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            )}
          >
            <span className="text-foreground/90">{question.text}</span>
            <ArrowUpRight
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
          </button>
        </motion.li>
      ))}
    </motion.ul>
  );
}
