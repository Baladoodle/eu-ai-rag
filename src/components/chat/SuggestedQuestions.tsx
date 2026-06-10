"use client"

/**
 * SuggestedQuestions
 * ----------------------------------------------------------------------------
 * Renders 3-4 starter questions as clickable chips. Clicking submits the
 * question immediately — the empty state has no composer context to
 * "fill", and the questions are vetted to be a useful default. The user
 * can always type their own question instead.
 * ----------------------------------------------------------------------------
 */
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { chipVariants, messageListVariants } from "@/lib/motion";

export interface SuggestedQuestion {
  /** Stable id, e.g. "rag-overview". Used as the React key. */
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
