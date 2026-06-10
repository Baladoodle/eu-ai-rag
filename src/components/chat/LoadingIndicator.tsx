"use client"

/**
 * LoadingIndicator
 * ----------------------------------------------------------------------------
 * Three pulsing dots. Reused for the "thinking" row at the start of a stream
 * and as the in-message cursor for the very last byte of streaming text.
 * Single source of truth for the dot grid keeps cadence consistent.
 * ----------------------------------------------------------------------------
 */
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { dotVariants } from "@/lib/motion";

interface LoadingIndicatorProps {
  /** Override the screen-reader label. Defaults to "Assistant is thinking". */
  label?: string;
  className?: string;
}

export function LoadingIndicator({ label = "Assistant is thinking", className }: LoadingIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn("flex items-center gap-1.5", className)}
    >
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          variants={dotVariants}
          initial="start"
          animate="pulse"
          transition={{ delay: i * 0.12 }}
          className="block size-1.5 rounded-full bg-muted-foreground/70"
        />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
