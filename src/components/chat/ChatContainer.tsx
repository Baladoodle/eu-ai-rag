"use client"

/**
 * ChatContainer
 * ----------------------------------------------------------------------------
 * The full chat surface: history sidebar, header, transcript (or empty
 * state), the optional BrowseTheAct panel, and the composer. Owns the
 * useChatState + useChatHistory hooks so siblings don't have to know
 * how either is configured.
 *
 * Layout (md+):
 *   - Left: persistent chat history rail (280px, collapsible to 56px).
 *   - Right: the chat column (header, transcript, composer) capped at
 *     2xl (672px) width and centered.
 *
 * Layout (mobile):
 *   - History is a drawer; the header has a hamburger button that
 *     toggles it. Escape closes the drawer.
 *
 * The BrowseTheAct panel sits in a "below the empty state, above the
 * composer" slot: it gives users a quick scan of the Act's structure
 * and a way to seed a query from any article title.
 * ----------------------------------------------------------------------------
 */
import { motion, AnimatePresence } from "framer-motion";
import { Menu } from "lucide-react";
import * as React from "react";

import { BrowseTheAct } from "@/components/chat/BrowseTheAct";
import { ChatHistory } from "@/components/chat/ChatHistory";
import { ChatInput } from "@/components/chat/ChatInput";
import { EmptyState } from "@/components/chat/EmptyState";
import { MessageList } from "@/components/chat/MessageList";
import { Button } from "@/components/ui/button";
import { fadeInVariants } from "@/lib/motion";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";

import { useChatState } from "./hooks/useChatState";
import { useChatHistory } from "./hooks/useChatHistory";
import { SUGGESTED_QUESTIONS } from "./SuggestedQuestions";

/** localStorage key for the sidebar collapsed/expanded state. */
const COLLAPSE_KEY = "eu-ai-act-expert:history-collapsed";

/**
 * Read the persisted collapsed flag. Safe at SSR (returns false there
 * so the first paint is the expanded default); swallows localStorage
 * failures so private-mode browsers don't crash the render.
 */
function readCollapsedFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Subscribe to localStorage changes for the collapsed flag so
 * useSyncExternalStore re-renders when the value flips. Listens to the
 * `storage` event (cross-tab) plus a custom event we dispatch after
 * every local write so a same-tab toggle reflects immediately.
 */
function subscribeToCollapsed(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === COLLAPSE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(COLLAPSE_KEY, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(COLLAPSE_KEY, callback);
  };
}

export function ChatContainer() {
  const history = useChatHistory();

  // Active chat id. We pin it to a per-tab session id when there's no
  // stored conversation yet; once the user starts chatting the
  // history hook promotes it into the persisted list.
  const [activeChatId, setActiveChatId] = React.useState<string>(() => history.activeId ?? createLocalId());

  // The chat hook binds to `activeChatId`. When the user picks a
  // different row in the sidebar we update this state and the SDK
  // remounts the stream with the new id.
  const {
    messages,
    streamingMessageId,
    isStreaming,
    isInitialLoading,
    error,
    send,
    stop,
    reset,
    retry,
    loadMessages,
  } = useChatState({ chatId: activeChatId });

  const hasMessages = messages.length > 0;

  // Capture the persist function via a ref so the auto-save effect
  // doesn't depend on the `history` object. Why: `history` is a fresh
  // object on every render (the hook doesn't memoize its return), and
  // `conversations` is a new reference every time localStorage is
  // written (cache invalidation). Including `history` in the deps
  // would re-fire this effect on every render, which would call
  // `persist`, which would write to localStorage 500ms later, which
  // would re-fire the cycle. Capturing the stable function via ref
  // breaks the cycle while still letting us call the latest version.
  const persistRef = React.useRef(history.persist);
  React.useEffect(() => {
    persistRef.current = history.persist;
  });

  // Keep history.activeId in sync with the active chat id. We capture
  // setActiveId via a ref so this effect depends only on activeChatId.
  // The previous version listed `history` in the deps, but `history`
  // is a fresh object on every render (the hook doesn't memoize its
  // return), so the effect re-fired on every render — calling
  // setActiveId which caused cascading re-renders and a "maximum
  // update depth exceeded" crash.
  const setActiveIdRef = React.useRef(history.setActiveId);
  React.useEffect(() => {
    setActiveIdRef.current = history.setActiveId;
  });
  React.useEffect(() => {
    setActiveIdRef.current(activeChatId);
  }, [activeChatId]);

  // Auto-save the live message list to localStorage, debounced inside
  // the hook. We never persist an empty array: an empty chat shouldn't
  // appear in the history list at all. The previous version used a
  // hasLoadedOnceRef sentinel to skip just the FIRST empty render,
  // but that let later "new chat" clicks (with messages cleared back
  // to []) slip through and create phantom entries.
  React.useEffect(() => {
    if (messages.length === 0) return;
    persistRef.current(messages);
  }, [messages]);

  // Load stored messages when the active chat changes. The hook's
  // internal state is keyed on a stable id, so switching the user's
  // chatId doesn't reset it — we have to push the stored messages in
  // ourselves. Without this, clicking a history row showed an empty
  // chat (because the SDK's id tied to the new chatId and reset).
  //
  // Both `loadMessages` and `history.get` go through refs. The
  // effect's dep is only `activeChatId`. Listing `history` directly
  // would re-fire the effect every render (history is a fresh
  // object each call) and clobber the chat surface mid-stream —
  // which is what produced the "question resets and a phantom
  // New chat entry appears" symptom.
  const loadMessagesRef = React.useRef(loadMessages);
  const historyGetRef = React.useRef(history.get);
  React.useEffect(() => {
    loadMessagesRef.current = loadMessages;
    historyGetRef.current = history.get;
  });
  React.useEffect(() => {
    const stored = historyGetRef.current(activeChatId);
    if (stored) {
      loadMessagesRef.current(stored.messages);
    } else {
      loadMessagesRef.current([]);
    }
  }, [activeChatId]);

  // Sidebar collapsed/expanded state. Driven by useSyncExternalStore so
  // the SSR snapshot and the first client paint agree (both read
  // localStorage on the client, return false on the server), and the
  // component re-renders if another tab (or our own toggle) flips the
  // persisted value.
  const collapsed = React.useSyncExternalStore(
    subscribeToCollapsed,
    readCollapsedFromStorage,
    () => false
  );
  const setCollapsed = React.useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // ignore — localStorage may be unavailable
    }
    // Notify same-tab subscribers; the storage event doesn't fire
    // inside the tab that did the write.
    window.dispatchEvent(new Event(COLLAPSE_KEY));
  }, []);
  const toggleCollapsed = React.useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  // Mobile drawer state. Defaults closed; opens via the hamburger.
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  // Close on Escape.
  React.useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // When the viewport widens past md, close the drawer (it's a no-op
  // visually but cleans up the state).
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (event: MediaQueryListEvent) => {
      if (event.matches) setDrawerOpen(false);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Suppress the "unused" warning on the hydration sentinel — it's
  // currently informational only.

  const handleNewChat = React.useCallback(() => {
    log.info("chat.history.new");
    const id = createLocalId();
    setActiveChatId(id);
    history.setActiveId(id);
    reset();
    setDrawerOpen(false);
  }, [history, reset]);

  const handleSelectConversation = React.useCallback(
    (id: string) => {
      log.info({ id }, "chat.history.switch");
      // Just switch the id; the activeChatId useEffect above loads
      // the stored messages (or clears the chat if none).
      setActiveChatId(id);
      setDrawerOpen(false);
    },
    [],
  );

  const handleDeleteConversation = React.useCallback(
    (id: string) => {
      history.remove(id);
      // If we deleted the active conversation, start a fresh one.
      if (id === activeChatId) {
        const fresh = createLocalId();
        setActiveChatId(fresh);
        history.setActiveId(fresh);
        reset();
      }
    },
    [activeChatId, history, reset]
  );

  const handleClearAll = React.useCallback(() => {
    log.info({ count: history.conversations.length }, "chat.history.clearAll");
    // Remove every conversation other than the active one, then delete
    // the active one too — and reset the chat surface to empty.
    for (const conversation of history.conversations) {
      history.remove(conversation.id);
    }
    const fresh = createLocalId();
    setActiveChatId(fresh);
    history.setActiveId(fresh);
    reset();
  }, [history, reset]);

  // Sidebar width is conditional on collapsed state. We pin the
  // sidebar to position: fixed (below) so the chat column takes the
  // full viewport width and the centered content (max-w-2xl mx-auto)
  // is actually centered to the viewport — not to the post-sidebar
  // area, which would feel "pushed to the right".
  const sidebarWidth = collapsed ? 56 : 280;

  return (
    <>
      {/*
       * Persistent history rail (md+). Fixed-positioned so it
       * overlays the chat column rather than pushing it; the chat
       * column gets the full viewport width and centers its content
       * to the actual viewport center. The rail carries the brand
       * ("EU AI Act Expert") in its own header — no page-level
       * header needed.
       */}
      <div
        className="hidden md:block fixed inset-y-0 left-0 z-30 transition-[width] duration-200 ease-out"
        style={{ width: `${sidebarWidth}px` }}
      >
        <ChatHistory
          conversations={history.conversations}
          activeId={activeChatId}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onSelect={handleSelectConversation}
          onNewChat={handleNewChat}
          onDelete={handleDeleteConversation}
          onClearAll={handleClearAll}
          variant="rail"
        />
      </div>

      <div className="flex h-full w-full min-w-0 flex-col">
        {/*
         * Minimal top bar: hamburger on the left (mobile only, since
         * the rail is persistent on md+), brand text centered, and a
         * New chat button on the right when there are messages.
         * Intentionally light — the rail carries the full chrome
         * (HISTORY label, collapse, conversation list, Clear all).
         */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 border-b border-border/40 px-2 py-2",
            "bg-background/60 backdrop-blur supports-[backdrop-filter]:bg-background/40"
          )}
        >
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => setDrawerOpen(true)}
              variant="ghost"
              size="icon-sm"
              aria-label="Open chat history"
              className="md:hidden"
            >
              <Menu className="size-4" aria-hidden="true" />
            </Button>
          </div>

          {/*
           * flex-1 makes the brand text fill the remaining horizontal
           * space between the left cluster and the right button; text-center
           * centers it within that space. pointer-events-none keeps the
           * span out of the click path so it doesn't intercept clicks
           * on the New chat button.
           */}
          <span className="pointer-events-none flex-1 text-center text-sm font-medium tracking-tight">
            EU AI Act Expert
          </span>

          <div className="flex items-center gap-1">
            {hasMessages ? (
              <Button
                type="button"
                onClick={handleNewChat}
                variant="ghost"
                size="sm"
                aria-label="Start a new conversation"
              >
                New chat
              </Button>
            ) : null}
          </div>
        </div>

        <main className="relative flex flex-1 flex-col overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {hasMessages ? (
              <motion.div
                key="list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-1 flex-col overflow-hidden"
              >
                <MessageList
                  messages={messages}
                  streamingMessageId={streamingMessageId}
                />
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="flex min-h-0 flex-1 flex-col"
              >
                {isInitialLoading ? (
                  <div className="flex flex-1 items-center justify-center">
                    <span className="text-sm text-muted-foreground">
                      Preparing your assistant…
                    </span>
                  </div>
                ) : (
                  <EmptyState
                    questions={SUGGESTED_QUESTIONS}
                    onSelect={send}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error ? (
              <ErrorBanner
                key={error.code}
                code={error.code}
                message={error.message}
                onRetry={retry}
              />
            ) : null}
          </AnimatePresence>

          {!hasMessages ? (
            <BrowseTheAct onSelectArticle={send} />
          ) : null}

          <ChatInput
            onSubmit={send}
            onStop={stop}
            isStreaming={isStreaming}
          />
        </main>
      </div>

      {/*
       * Mobile drawer. The history list is the SAME component used for
       * the rail, just in `variant="drawer"`. We render it in a fixed
       * panel with a backdrop; Escape and a close button dismiss it.
       */}
      <AnimatePresence>
        {drawerOpen ? (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-0 z-40 bg-black/40 md:hidden"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-y-0 left-0 z-50 md:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Chat history"
            >
              <ChatHistory
                conversations={history.conversations}
                activeId={activeChatId}
                collapsed={false}
                onToggleCollapsed={toggleCollapsed}
                onSelect={handleSelectConversation}
                onNewChat={handleNewChat}
                onDelete={handleDeleteConversation}
                onClearAll={handleClearAll}
                variant="drawer"
                onCloseDrawer={() => setDrawerOpen(false)}
              />
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}

// ----------------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------------

interface ErrorBannerProps {
  code: string;
  message: string;
  onRetry: () => void;
}

function ErrorBanner({ code, message, onRetry }: ErrorBannerProps) {
  return (
    <motion.div
      role="alert"
      initial="hidden"
      animate="visible"
      exit="hidden"
      variants={fadeInVariants}
      className="mx-auto w-full max-w-2xl px-4 pb-2"
    >
      <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-medium text-foreground">
            {humanizeErrorCode(code)}
          </span>
          <span className="text-muted-foreground">{message}</span>
        </div>
        <Button
          type="button"
          onClick={onRetry}
          variant="outline"
          size="sm"
          aria-label="Retry last message"
        >
          Retry
        </Button>
      </div>
    </motion.div>
  );
}

function humanizeErrorCode(code: string): string {
  switch (code) {
    case "RETRIEVAL_EMPTY":
      return "No relevant articles found";
    case "RETRIEVAL_LOW_CONFIDENCE":
      return "Low confidence answer";
    case "LLM_TIMEOUT":
      return "Assistant timed out";
    case "LLM_5XX":
      return "Assistant error";
    default:
      return "Something went wrong";
  }
}

function createLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
