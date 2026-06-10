/**
 * motion.ts
 * ----------------------------------------------------------------------------
 * Shared Framer Motion variants and transitions for the chat UI.
 *
 * Why a single source of truth: every animation in the chat should feel
 * like part of one product. Centralising the easing curves and durations
 * here means message entry, citation reveal, and scroll behaviour all
 * use the same "voice" — and changing it later is a one-file edit.
 *
 * Aesthetic (per CLAUDE.md UI rules, mastra.ai reference):
 *  - No bouncy springs. Linear-ish easing with a touch of overshoot
 *    where it serves legibility (e.g. message entry).
 *  - Durations are short enough to feel snappy (180-260ms) and never
 *    long enough to make the user wait.
 *  - No spin, no flash, no scale > 1.02. Subtle.
 * ----------------------------------------------------------------------------
 */
import type { Transition, Variants } from "framer-motion";

/**
 * Master easing curve. cubic-bezier(0.16, 1, 0.3, 1) is the well-known
 * "easeOutExpo" — fast start, gentle landing. Reads as intentional, not
 * mechanical.
 */
export const easeOut: Transition["ease"] = [0.16, 1, 0.3, 1];

/**
 * Standard durations. Use these names instead of magic numbers in
 * components so timing is easy to retune in one place.
 */
export const duration = {
  fast: 0.16,
  base: 0.22,
  slow: 0.36,
} as const;

/**
 * A message entering the conversation.
 *
 * Why these values: -8px Y + 1% scale + opacity is the minimum amount
 * of motion that reads as "new thing" without crossing into cartoonish.
 * No spring — pure tween — so the cadence stays predictable across
 * many messages.
 */
export const messageVariants: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.99 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: duration.base, ease: easeOut },
  },
};

/**
 * The list itself does not animate — only its children. We use
 * `staggerChildren` purely to give the first 2-3 messages a tiny
 * cascade so the initial empty-state → conversation transition
 * feels alive.
 */
export const messageListVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
};

/**
 * A citation panel revealing under a message. Slides a few px and fades.
 * Same easing as message entry so they feel like one system.
 */
export const citationPanelVariants: Variants = {
  hidden: { opacity: 0, y: 4, height: 0 },
  visible: {
    opacity: 1,
    y: 0,
    height: "auto",
    transition: { duration: duration.base, ease: easeOut },
  },
  exit: {
    opacity: 0,
    y: 4,
    height: 0,
    transition: { duration: duration.fast, ease: easeOut },
  },
};

/**
 * Suggested-question chip. Subtle scale-up + fade. Each child is staggered
 * by the parent list variant.
 */
export const chipVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: easeOut },
  },
};

/**
 * Loader dot. Each dot uses this; the parent applies the per-dot delay.
 */
export const dotVariants: Variants = {
  start: { opacity: 0.3, y: 0 },
  pulse: {
    opacity: 1,
    y: -2,
    transition: { duration: 0.6, ease: easeOut, repeat: Infinity, repeatType: "reverse" },
  },
};

/**
 * Fade + tiny rise. Used by the empty-state mount, the header on first
 * paint, and the "error banner" when it appears.
 */
export const fadeInVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.slow, ease: easeOut },
  },
};
