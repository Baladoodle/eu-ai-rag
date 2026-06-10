"use client"

/**
 * ChatInput
 * ----------------------------------------------------------------------------
 * The composer at the bottom of the chat. A growing textarea, a submit
 * button, and a stop button when the parent is streaming.
 *
 * Why a textarea (not <input>): chat prompts are almost always more than
 * one line, and the user should be able to write a paragraph without the
 * composer fighting them.
 *
 * Keyboard:
 *   - Enter submits
 *   - Shift+Enter inserts a newline
 *   - Escape while focused does nothing destructive (the user is mid-thought)
 *
 * The shell uses Framer Motion to fade the focus state in and out so the
 * border lift never feels janky on first click. This keeps the visual
 * state change aligned with the rest of the chat (Framer Motion
 * everywhere; no CSS transition utilities for state).
 * ----------------------------------------------------------------------------
 */
import { motion } from "framer-motion";
import { ArrowUp, Square } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { duration, easeOut } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  /** Called when the user submits a non-empty message. */
  onSubmit: (text: string) => void;
  /** Called when the user clicks the stop button while streaming. */
  onStop?: () => void;
  /** True while the assistant is generating. Disables submit; reveals Stop. */
  isStreaming?: boolean;
  /** Optional placeholder override. */
  placeholder?: string;
  /** Optional className for the outer form. */
  className?: string;
}

const MAX_TEXTAREA_HEIGHT = 220;

export function ChatInput({
  onSubmit,
  onStop,
  isStreaming = false,
  placeholder = "Ask about the EU AI Act…",
  className,
}: ChatInputProps) {
  const [value, setValue] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow the textarea up to a cap. We measure with `scrollHeight`
  // on every keystroke — cheap because the textarea only ever holds
  // a few hundred characters in normal use.
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !isStreaming;

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
    // Reset the textarea height so the composer doesn't keep a tall box
    // after a multi-line send.
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      className={cn(
        "mx-auto w-full max-w-2xl px-4 pb-6 pt-2",
        className
      )}
    >
      <motion.div
        animate={{
          borderColor: focused
            ? "color-mix(in oklch, var(--foreground) 22%, transparent)"
            : "color-mix(in oklch, var(--foreground) 9%, transparent)",
          backgroundColor: focused
            ? "color-mix(in oklch, var(--card) 90%, var(--foreground) 10%)"
            : "color-mix(in oklch, var(--card) 100%, transparent)",
        }}
        transition={{ duration: duration.base, ease: easeOut }}
        className={cn(
          "group relative flex items-end gap-2 rounded-2xl border bg-card/50 p-2.5",
          "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.18)]"
        )}
      >
        <label htmlFor="chat-composer" className="sr-only">
          Message
        </label>
        <textarea
          id="chat-composer"
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          spellCheck
          autoComplete="off"
          className={cn(
            "min-h-9 max-h-[220px] flex-1 resize-none border-0 bg-transparent px-2 py-1.5",
            "text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground/80",
            "outline-none focus:outline-none focus-visible:outline-none"
          )}
        />

        {isStreaming && onStop ? (
          <Button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            size="icon"
            variant="outline"
            className="size-9 shrink-0 rounded-xl"
          >
            <Square className="size-3.5 fill-current" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={!canSend}
            aria-label="Send message"
            size="icon"
            className="size-9 shrink-0 rounded-xl"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </Button>
        )}
      </motion.div>
      <p className="mt-2.5 px-2 text-[10px] text-muted-foreground/80">
        Press <kbd className="rounded border border-border/60 bg-muted/40 px-1 text-[9px]">Enter</kbd> to send, <kbd className="rounded border border-border/60 bg-muted/40 px-1 text-[9px]">Shift+Enter</kbd> for newline. Answers cite EU AI Act articles.
      </p>
    </form>
  );
}
