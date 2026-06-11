"use client"

/**
 * EmptyState
 * ----------------------------------------------------------------------------
 * The full-area welcome state shown when the conversation has no messages.
 * Composes the regulation pill, a heading, a one-line value prop, the
 * suggested questions, and (handled by ChatContainer) the BrowseTheAct
 * trigger + composer. Minimal copy — the page is the product.
 *
 * The hint line is intentionally regulation-specific so the user
 * understands the corpus: risk categories, provider obligations,
 * transparency rules, and GPAI.
 *
 * Layout: the column is centered vertically in its parent (h-full +
 * justify-center) and uses a 2-step rhythm — 12px between the hero
 * group's pill / heading / paragraphs, and 24px between the hero group
 * and the suggested-question grid.
 *
 * Top breathing room: we apply a generous top padding (pt-24 on small
 * viewports, pt-32 from sm up) so the hero does not crowd the top edge
 * of the viewport. On tall viewports the inner column is also centered
 * via flex, so the whole composition reads as a deliberate hero block
 * rather than something glued to the header.
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
        "mx-auto flex h-full min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center gap-6 px-4 pb-8 pt-24 text-center sm:pt-32",
        className
      )}
    >
      <div className="flex flex-col items-center gap-2.5">
        <span className="rounded-full border border-border/60 bg-card/40 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Regulation (EU) 2024/1689
        </span>
        <h1 className="font-heading text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Ask about the EU AI Act.
        </h1>
        <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
          Cited answers, grounded in the Articles, Recitals, and Annexes of the Act.
        </p>
        <p className="max-w-sm text-balance text-xs text-muted-foreground/80">
          Try risk categories, provider obligations, transparency rules, or GPAI.
        </p>
      </div>

      <SuggestedQuestions questions={questions} onSelect={onSelect} />
    </motion.div>
  );
}
