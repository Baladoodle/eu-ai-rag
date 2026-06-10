"use client"

/**
 * MessageList
 * ----------------------------------------------------------------------------
 * Renders the vertical stack of messages and keeps the viewport scrolled
 * to the bottom as new tokens stream in.
 *
 * Why we own scroll management here (not in ChatContainer): the list
 * doesn't need to know about the composer, and the container doesn't
 * need to know about message heights. Splitting the concern makes each
 * component testable in isolation.
 *
 * Why we don't use react-virtuoso: our message count per session is tiny
 * (sub-100 in the worst case). Virtualization would add weight for no
 * perceived benefit at this scale.
 *
 * Auto-scroll respects the user: if they've scrolled UP to re-read an
 * earlier answer, we don't yank the view back to the bottom on every
 * streamed token. We only follow the tail when the user is already
 * within `NEAR_BOTTOM_PX` of the bottom.
 * ----------------------------------------------------------------------------
 */
import { motion } from "framer-motion";
import * as React from "react";
import type { UIMessage } from "ai";

import { Message } from "@/components/chat/Message";
import { messageListVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface MessageListProps {
  messages: UIMessage[];
  /**
   * The id of the message currently being streamed, or null if none.
   * We pass this down so the caret and "thinking" indicator light up on
   * exactly one message at a time.
   */
  streamingMessageId?: string | null;
  className?: string;
}

/**
 * If the user is within this many pixels of the bottom, we treat the
 * viewport as "following" and snap to the bottom on new content.
 * 100px is large enough to cover a streaming caret but small enough that
 * a deliberate scroll-up disables auto-follow reliably.
 */
const NEAR_BOTTOM_PX = 100;

export function MessageList({ messages, streamingMessageId = null, className }: MessageListProps) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const lastLengthRef = React.useRef(0);

  // Auto-scroll to the bottom on every change to messages, BUT only if
  // the user hasn't scrolled up to read earlier content. We measure
  // distance-to-bottom inside requestAnimationFrame so the DOM has
  // laid out the new text first.
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    // Skip the very first render: nothing to scroll to.
    if (lastLengthRef.current === 0 && messages.length === 0) return;

    const frame = requestAnimationFrame(() => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const shouldFollow = distanceFromBottom <= NEAR_BOTTOM_PX;
      if (shouldFollow) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      }
    });
    lastLengthRef.current = messages.length;

    return () => cancelAnimationFrame(frame);
  }, [messages]);

  return (
    <div
      ref={viewportRef}
      role="log"
      aria-live="polite"
      aria-label="Conversation transcript"
      className={cn("flex h-full w-full flex-col overflow-y-auto", className)}
    >
      <motion.ol
        initial="hidden"
        animate="visible"
        variants={messageListVariants}
        className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6"
      >
        {messages.map((message) => (
          <li key={message.id} className="w-full">
            <Message
              message={message}
              isStreaming={streamingMessageId === message.id}
            />
          </li>
        ))}
      </motion.ol>
    </div>
  );
}
