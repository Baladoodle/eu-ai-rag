"use client"

/**
 * ChatHistory
 * ----------------------------------------------------------------------------
 * The left-side conversation history sidebar. On md+ viewports the panel
 * is persistent; the user can collapse it to a 56px icon rail. On
 * narrow viewports the panel is hidden by default and opens as a left
 * drawer via the hamburger button in the chat header.
 *
 * Per row: title, relative date, message count badge, hover state, and
 * a delete affordance that requires an explicit confirm step. The
 * "active" row is highlighted with a left stripe in the type accent
 * colour so it always reads as the current conversation.
 *
 * Why a left sidebar (not right): the source citations already live
 * under each message; the left rail carries ambient context (recent
 * chats) that the user reaches for between sessions, not mid-answer.
 * Mirrors the convention set by ChatGPT, Claude.ai, Linear, etc.
 * ----------------------------------------------------------------------------
 */
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Trash2, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { duration, easeOut, fadeInVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { Conversation } from "@/components/chat/hooks/useChatHistory";
import { messageCount } from "@/components/chat/hooks/useChatHistory";

// ----------------------------------------------------------------------------
// Relative date formatting
// ----------------------------------------------------------------------------

const RELATIVE_THRESHOLDS: Array<[number, Intl.RelativeTimeFormatUnit]> = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.34524, "week"],
  [12, "month"],
  [Number.POSITIVE_INFINITY, "year"],
];

/**
 * Convert an ISO date string to a compact relative label like "2 hours
 * ago" / "3 days ago". Uses `Intl.RelativeTimeFormat` so the output
 * matches the browser's locale.
 */
export function relativeDate(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  let diffSeconds = (then.getTime() - now.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [divisor, unit] of RELATIVE_THRESHOLDS) {
    if (Math.abs(diffSeconds) < divisor) {
      return rtf.format(Math.round(diffSeconds), unit);
    }
    diffSeconds /= divisor;
  }
  return "";
}

// ----------------------------------------------------------------------------
// ChatHistory — the component.
// ----------------------------------------------------------------------------

export interface ChatHistoryProps {
  conversations: Conversation[];
  activeId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  /**
   * Optional: if present, the footer renders a "Clear all" action.
   * Hidden when there are no conversations so a fresh sidebar stays clean.
   */
  onClearAll?: () => void;
  /**
   * If non-null, we're rendering inside a mobile drawer and the parent
   * is responsible for closing it after a selection. The button gets a
   * slightly different hit-area in this mode (full-width, easier to tap).
   */
  variant?: "rail" | "drawer";
  onCloseDrawer?: () => void;
  className?: string;
}

export function ChatHistory({
  conversations,
  activeId,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onNewChat,
  onDelete,
  onClearAll,
  variant = "rail",
  onCloseDrawer,
  className,
}: ChatHistoryProps) {
  // When collapsed we still show the + (new chat) and the toggle, but
  // hide the conversation list. Drawer mode is always expanded.
  const isExpanded = variant === "drawer" || !collapsed;

  return (
    <aside
      aria-label="Chat history"
      data-collapsed={!isExpanded ? "true" : undefined}
      className={cn(
        "flex h-full flex-col border-r border-border/40 bg-card/30",
        // Persistent rail: fixed width, transitions on collapse.
        variant === "rail" && "transition-[width] duration-200 ease-out",
        variant === "rail" && (isExpanded ? "w-[280px]" : "w-[56px]"),
        // Drawer mode: always full-width, mobile only.
        variant === "drawer" && "w-[300px] max-w-[85vw]",
        className
      )}
    >
      {/*
       * Header — title + new-chat button + collapse toggle. We keep the
       * chrome identical between expanded and collapsed so the eye
       * doesn't have to relearn the layout.
       */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-1.5 border-b border-border/40 px-2 py-2.5",
          isExpanded ? "justify-between" : "flex-col justify-center"
        )}
      >
        {isExpanded ? (
          <span className="px-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            History
          </span>
        ) : null}
        <div className={cn("flex items-center gap-1", !isExpanded && "flex-col")}>
          {variant === "drawer" && onCloseDrawer ? (
            <Button
              type="button"
              onClick={onCloseDrawer}
              variant="ghost"
              size="icon-xs"
              aria-label="Close history"
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}
          {variant === "rail" ? (
            <Button
              type="button"
              onClick={onToggleCollapsed}
              variant="ghost"
              size="icon-xs"
              aria-label={collapsed ? "Expand history" : "Collapse history"}
              aria-expanded={!collapsed}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-3.5" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="size-3.5" aria-hidden="true" />
              )}
            </Button>
          ) : null}
        </div>
      </div>

      {/*
       * New-chat button. Always visible (the only persistent affordance
       * when the rail is collapsed). Uses a square icon-only button in
       * collapsed mode so the rail stays narrow.
       */}
      <div
        className={cn(
          "shrink-0 p-2",
          // Center the new-chat button in the 56px rail when
          // collapsed. With only horizontal padding the button was
          // sitting flush against the left edge.
          !isExpanded && "flex justify-center"
        )}
      >
        <Button
          type="button"
          onClick={onNewChat}
          variant="default"
          size={isExpanded ? "sm" : "icon-lg"}
          aria-label="Start a new conversation"
          // Why w-full only when expanded: in icon mode the button
          // is meant to be a square (matching the rail's 56px width
          // minus padding). The full-width stretch only makes sense
          // for the expanded layout where the button needs to read as
          // a primary CTA.
          className={cn(isExpanded && "w-full justify-start gap-2")}
        >
          <Plus className="size-4" aria-hidden="true" />
          {isExpanded ? <span>New chat</span> : null}
        </Button>
      </div>

      {/*
       * Conversation list. Rendered only when the rail is expanded. In
       * collapsed mode the rail is pure chrome (toggle + new chat) so
       * the list never crowds 56px. The full list returns when the
       * user expands — see `isExpanded` check below.
       *
       * ScrollArea handles overflow so the rail never grows past the
       * viewport. We key the list on the active id so layout
       * transitions feel intentional.
       */}
      {isExpanded ? (
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {conversations.length === 0 ? (
            <EmptyHistory />
          ) : (
            <ul role="list" className="flex flex-col gap-0.5">
              {conversations.map((conversation) => (
                <HistoryRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeId}
                  onSelect={() => onSelect(conversation.id)}
                  onDelete={() => onDelete(conversation.id)}
                />
              ))}
            </ul>
          )}
        </div>
      ) : (
        // Collapsed: chrome only. The conversation list returns when
        // the user expands the rail. The remaining flex space is
        // intentional empty chrome — it makes the rail feel anchored
        // without rendering a tiny icon list that's hard to parse.
        <div className="flex-1" aria-hidden="true" />
      )}

      {/*
       * Footer — always-visible at the bottom of the rail so the
       * sidebar has a proper ground and the dead space below the
       * conversation list reads as intentional. Shows a keyboard
       * shortcut hint and a "Clear all" affordance (visible only when
       * there are conversations, so a brand-new sidebar stays clean).
       */}
      {isExpanded ? (
        <div className="shrink-0 border-t border-border/40 px-3 py-2.5">
          <HistoryFooter
            hasConversations={conversations.length > 0}
            onClearAll={onClearAll}
          />
        </div>
      ) : null}
    </aside>
  );
}

// ----------------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------------

function EmptyHistory() {
  return (
    <motion.div
      role="status"
      initial="hidden"
      animate="visible"
      variants={fadeInVariants}
      className="flex flex-col items-center gap-2 px-3 py-6 text-center"
    >
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-full border border-border/60 bg-card/40 text-muted-foreground"
      >
        <MessageSquare className="size-3.5" />
      </span>
      <p className="text-[11px] font-medium text-foreground/80">No past conversations</p>
      <p className="max-w-[180px] text-[10px] text-muted-foreground/80">
        Start your first chat — it&apos;ll be saved here automatically.
      </p>
    </motion.div>
  );
}

interface HistoryRowProps {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function HistoryRow({ conversation, active, onSelect, onDelete }: HistoryRowProps) {
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const count = messageCount(conversation);
  const dateLabel = relativeDate(conversation.updatedAt);

  return (
    <li>
      {/*
       * Per CLAUDE.md: use Framer Motion for state transitions. The row
       * drives bg + border via whileHover and a "active" variant. The
       * left stripe (the `::before`-style span) carries the type-accent
       * colour when the row is active.
       */}
      <motion.div
        animate={active ? "active" : "rest"}
        whileHover="hover"
        initial={false}
        variants={{
          rest: {
            backgroundColor: "color-mix(in oklch, var(--card) 0%, transparent)",
          },
          hover: {
            backgroundColor: "color-mix(in oklch, var(--card) 50%, transparent)",
            transition: { duration: duration.fast, ease: easeOut },
          },
          active: {
            backgroundColor: "color-mix(in oklch, var(--card) 60%, transparent)",
            transition: { duration: duration.fast, ease: easeOut },
          },
        }}
        className={cn(
          "group relative flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left",
          "focus-within:ring-2 focus-within:ring-ring/40"
        )}
      >
        {active ? (
          <motion.span
            layoutId="history-active-stripe"
            aria-hidden="true"
            transition={{ duration: duration.base, ease: easeOut }}
            className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-primary"
          />
        ) : null}

        <button
          type="button"
          onClick={onSelect}
          aria-current={active ? "page" : undefined}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left focus-visible:outline-none"
        >
          <span className="flex w-full items-center gap-2">
            <span className="truncate text-xs font-medium text-foreground/90">
              {conversation.title}
            </span>
            {count > 0 ? (
              <span className="ml-auto shrink-0 rounded-full border border-border/50 bg-card/40 px-1.5 py-px text-[9px] font-medium tabular-nums text-muted-foreground">
                {count}
              </span>
            ) : null}
          </span>
          {dateLabel ? (
            <span className="truncate text-[10px] text-muted-foreground/80">{dateLabel}</span>
          ) : null}
        </button>

        {/*
         * Delete affordance. Single click reveals a small "Delete?"
         * confirm popover (no modal, no navigation). Second click on
         * the destructive button commits the delete. A second click on
         * the cancel button — or Esc — dismisses the popover.
         */}
        <AnimatePresence mode="wait" initial={false}>
          {confirmingDelete ? (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: duration.fast, ease: easeOut }}
              className="flex items-center gap-1"
            >
              <Button
                type="button"
                size="xs"
                variant="destructive"
                onClick={() => {
                  onDelete();
                  setConfirmingDelete(false);
                }}
                aria-label="Confirm delete conversation"
              >
                Delete
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => setConfirmingDelete(false)}
                aria-label="Cancel delete"
              >
                Cancel
              </Button>
            </motion.div>
          ) : (
            <motion.button
              key="trash"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setConfirmingDelete(true);
              }}
              whileHover={{ color: "var(--destructive)" }}
              transition={{ duration: duration.fast, ease: easeOut }}
              aria-label={`Delete ${conversation.title}`}
              className="shrink-0 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            >
              <Trash2 className="size-3" aria-hidden="true" />
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>
    </li>
  );
}

// ----------------------------------------------------------------------------
// HistoryFooter — anchors the bottom of the rail so the sidebar reads as a
// complete surface (no dead space below the conversation list). Shows a
// small keyboard hint + a "Clear all" action.
// ----------------------------------------------------------------------------

interface HistoryFooterProps {
  hasConversations: boolean;
  onClearAll?: () => void;
}

function HistoryFooter({ hasConversations, onClearAll }: HistoryFooterProps) {
  return (
    <div className="flex flex-col gap-1.5 text-[10px] text-muted-foreground/70">
      <p className="text-pretty">
        Press <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-px font-mono text-[9px] text-foreground/80">Enter</kbd> to send, <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-px font-mono text-[9px] text-foreground/80">Shift</kbd>+<kbd className="rounded border border-border/60 bg-muted/40 px-1 py-px font-mono text-[9px] text-foreground/80">Enter</kbd> for newline
      </p>
      {hasConversations && onClearAll ? (
        <button
          type="button"
          onClick={onClearAll}
          className="self-start rounded text-[10px] text-muted-foreground underline decoration-muted-foreground/30 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Clear all conversations
        </button>
      ) : null}
    </div>
  );
}
