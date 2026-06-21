"use client"

/**
 * LoadingIndicator
 * ----------------------------------------------------------------------------
 * The "assistant is thinking" placeholder shown at the start of a stream
 * (and via the same component, before any tokens have arrived).
 *
 * Design:
 *   - The trailing word "Thinking" with a 3-character ellipsis that
 *     staggers in one dot at a time.
 *
 * Why no separate dot animation:
 *   A wave of bouncing dots next to a "Thinking..." label reads as two
 *   indicators fighting for the same job. One is enough.
 *
 * Why Framer Motion (not CSS keyframes):
 *   The ellipsis stagger uses per-dot `transition.delay`; Framer expresses
 *   that intent directly. CSS would need a separate `animation-delay` per
 *   dot, which is fine but less readable.
 * ----------------------------------------------------------------------------
 */
import { motion, type Variants } from "framer-motion";

import { cn } from "@/lib/utils";

interface LoadingIndicatorProps {
  /** Override the screen-reader label. Defaults to "Assistant is thinking". */
  label?: string;
  className?: string;
}

/**
 * The ellipsis after "Thinking". Each dot fades in with a stagger.
 * Repeating with mirror so it loops smoothly.
 */
const ellipsisDot: Variants = {
  rest: { opacity: 0.15 },
  wave: {
    opacity: [0.15, 1, 0.15],
    transition: {
      duration: 1.1,
      ease: "easeInOut",
      repeat: Infinity,
    },
  },
};

export function LoadingIndicator({
  label = "Assistant is thinking",
  className,
}: LoadingIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        // The text is the whole indicator now, so center it inside the
        // bubble instead of left-aligning. `min-h` matches the previous
        // dot row's footprint so the bubble doesn't reflow when tokens
        // arrive.
        "flex min-h-5 items-center justify-center text-xs text-muted-foreground/80 tabular-nums",
        className,
      )}
    >
      {/*
       * The word first, then the animated ellipsis. We render the
       * ellipsis as three real characters inside their own motion spans
       * so each dot can have a different stagger. The fixed-width
       * `inline-block` plus `tabular-nums` (on the parent) keeps the
       * three dots the same width as they fade in — no left/right
       * jitter.
       */}
      <span>Thinking</span>
      <span className="inline-block w-[1.5em] text-left">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            variants={ellipsisDot}
            initial="rest"
            animate="wave"
            transition={{ delay: i * 0.18 }}
          >
            .
          </motion.span>
        ))}
      </span>

      <span className="sr-only">{label}</span>
    </div>
  );
}
