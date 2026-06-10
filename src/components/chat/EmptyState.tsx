"use client"

/**
 * EmptyState
 * ----------------------------------------------------------------------------
 * The full-area welcome state shown when the conversation has no messages.
 * Composes the project name, a one-line value prop, and the suggested
 * questions. Minimal copy — the page is the product.
 *
 * The hint line is intentionally regulation-specific so the user
 * understands the corpus: risk categories, provider obligations,
 * transparency rules, and GPAI.
 * ----------------------------------------------------------------------------
 */
import { motion } from "framer-motion";

import { fadeInVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { SuggestedQuestions, type SuggestedQuestion } from "./SuggestedQuestions";

interface EmptyStateProps {
  questions: SuggestedQuestion[];
  onSelect: (text: string) => void;
  className?: string;
}

export function EmptyState({ questions, onSelect, className }: EmptyStateProps) {
  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial="hidden"
      animate="visible"
      variants={fadeInVariants}
      className={cn(
        "mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center gap-8 px-4 text-center",
        className
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <span className="rounded-full border border-border/60 bg-card/40 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Regulation (EU) 2024/1689
        </span>
        <h1 className="font-heading text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Ask about the EU AI Act.
        </h1>
        <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
          Cited answers, grounded in the Articles, Recitals, and Annexes of the Act.
        </p>
        <p className="max-w-sm text-pretty text-xs text-muted-foreground/80">
          Try risk categories, provider obligations, transparency rules, or GPAI.
        </p>
      </div>

      <SuggestedQuestions questions={questions} onSelect={onSelect} />
    </motion.div>
  );
}
