/**
 * src/components/chat/ReferenceList.tsx
 * ----------------------------------------------------------------------------
 * Render the "References" section — Articles / Recitals / Annexes that
 * the assistant *named* in its answer but didn't directly cite.
 *
 * Why this exists separately from SourceList:
 *   The Sources section answers "what evidence supports this answer?"
 *   The References section answers "what other parts of the Act did
 *   the answer touch on?" Sources are loaded into the prompt and
 *   cited inline with `[N]` markers. References are surfaced
 *   retroactively from text mentions so the user can click through
 *   to them without us re-running retrieval.
 *
 * Visual distinction:
 *   Sources get a full card with snippet + relevance bar.
 *   References get a tighter, single-line chip — they're navigational
 *   hints, not evidence. We don't want them to compete visually with
 *   the cited sources.
 */
"use client";

import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";

import type { Mention } from "@/components/chat/references";
import { referencePanelVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface ReferenceListProps {
  references: ReadonlyArray<Mention>;
  className?: string;
}

/**
 * Pick a colour hint per reference kind. We reuse the same palette as
 * the citation chips so the user gets visual consistency between inline
 * `[N]` chips and these reference chips — Article = primary tint,
 * Recital = violet, Annex = green, Commission = amber.
 */
function kindClass(kind: Mention["reference"]["kind"]): string {
  switch (kind) {
    case "Article":
      return "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15";
    case "Recital":
      return "bg-violet-500/10 text-violet-700 border-violet-500/20 hover:bg-violet-500/15 dark:text-violet-300";
    case "Annex":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 hover:bg-emerald-500/15 dark:text-emerald-300";
    case "Commission":
      return "bg-amber-500/10 text-amber-700 border-amber-500/20 hover:bg-amber-500/15 dark:text-amber-300";
  }
}

export function ReferenceList({ references, className }: ReferenceListProps) {
  if (references.length === 0) return null;

  return (
    <motion.section
      key="references"
      initial="hidden"
      animate="visible"
      variants={referencePanelVariants}
      aria-label="References mentioned"
      className={cn("mt-3 flex flex-col gap-1.5", className)}
    >
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        References
      </span>
      <ul role="list" className="flex flex-wrap gap-1.5">
        {references.map((mention) => {
          const ref = mention.reference;
          const label = `${ref.kind} ${ref.number}`;
          return (
            <li key={`${ref.kind}:${ref.number}`}>
              <a
                href={ref.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5",
                  "font-mono text-[0.72em] font-medium leading-tight",
                  "transition-colors",
                  kindClass(ref.kind),
                )}
                title={`${label} — ${ref.title}`}
              >
                <span>{label}</span>
                <ExternalLink
                  className="size-2.5 opacity-60"
                  aria-hidden="true"
                />
              </a>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
