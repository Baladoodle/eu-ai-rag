"use client"

/**
 * useChatHistory
 * ----------------------------------------------------------------------------
 * Persists chat conversations to localStorage. Each conversation is a
 * `{id, title, messages, createdAt, updatedAt}` record. We expose:
 *   - `conversations` — sorted, newest-first list
 *   - `activeId` — the id of the currently-loaded conversation
 *   - `persist(messages)` — debounced auto-save of the active conversation
 *   - `load(id)` / `remove(id)` / `create()` — explicit mutations
 *
 * The hook is decoupled from the AI SDK so it can be swapped to a
 * server-side backend in one place. Anything that wants to "save a chat"
 * just calls `persist(messages)`.
 *
 * Storage shape: a single JSON array under the key
 * `eu-ai-act-expert:conversations`. We tolerate malformed / missing
 * data and silently fall back to an empty list so a quota error or
 * private-mode browser doesn't crash the app.
 *
 * Why debounce: every keystroke during a stream produces a `messages`
 * array update. We coalesce to ~500ms so the localStorage write rate
 * stays sane even on long completions.
 * ----------------------------------------------------------------------------
 */
import { isTextUIPart, type UIMessage } from "ai";
import * as React from "react";

import { log } from "@/lib/logger";

const STORAGE_KEY = "eu-ai-act-expert:conversations";
const SAVE_DEBOUNCE_MS = 500;
/** Hard cap on kept conversations. Oldest are dropped first. */
const MAX_CONVERSATIONS = 50;
/** Title length cap for auto-generated titles. */
const TITLE_MAX = 60;

export interface Conversation {
  id: string;
  title: string;
  messages: UIMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface UseChatHistory {
  conversations: Conversation[];
  activeId: string | null;
  /** Read a conversation by id. Returns null if it doesn't exist. */
  get: (id: string) => Conversation | null;
  /** Debounced auto-save. Safe to call from a render-phase effect. */
  persist: (messages: UIMessage[]) => void;
  /** Mark a conversation as active (e.g. when loaded). */
  setActiveId: (id: string | null) => void;
  /** Create a new empty conversation and make it active. */
  create: () => string;
  /** Delete a conversation by id. No-op if it doesn't exist. */
  remove: (id: string) => void;
  /** Rename a conversation's title. */
  rename: (id: string, title: string) => void;
}

/**
 * Read all conversations from localStorage. Defensive: returns [] on
 * any failure (missing key, malformed JSON, quota blocked, etc.).
 */
function readAll(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isConversation);
  } catch (error) {
    log.warn({ error: String(error) }, "chat.history.read.failed");
    return [];
  }
}

/**
 * Type guard for the storage shape. Anything missing the required
 * fields is dropped silently — we'd rather show an empty list than
 * crash the app on a stray dev-tools edit.
 */
function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string" &&
    Array.isArray(v.messages)
  );
}

/**
 * Write the full conversation list back to storage. Wrapped in try/catch
 * because some browsers throw on quota exceeded.
 */
function writeAll(conversations: Conversation[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch (error) {
    log.warn({ error: String(error) }, "chat.history.write.failed");
  }
}

/**
 * Generate a title from the first user message. Strips markdown-ish
 * noise (backticks, leading bullets), collapses whitespace, and clamps
 * to `TITLE_MAX` chars on a word boundary when possible.
 */
export function autoTitle(messages: UIMessage[]): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.parts
      .filter(isTextUIPart)
      .map((p) => p.text)
      .join(" ")
      .replace(/[`*_~>#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    if (text.length <= TITLE_MAX) return text;
    const truncated = text.slice(0, TITLE_MAX);
    const lastSpace = truncated.lastIndexOf(" ");
    return lastSpace > 20 ? `${truncated.slice(0, lastSpace)}…` : `${truncated}…`;
  }
  return "New chat";
}

/**
 * The number of "exchanges" in a conversation — pairs of (user, assistant)
 * messages. Used as a small badge in the history row.
 */
export function messageCount(conversation: Conversation): number {
  let count = 0;
  for (const m of conversation.messages) {
    if (m.role === "user" || m.role === "assistant") count += 1;
  }
  return count;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * React hook. Owns the in-memory mirror of localStorage and exposes the
 * mutation API. Memoised so consumers can safely include returned
 * callbacks in their own `useEffect` deps.
 */
export function useChatHistory(): UseChatHistory {
  // We defer the initial read until mount so SSR returns the same empty
  // shape as a fresh browser session. Without this the server's
  // representation would diverge from the client and React would
  // re-render with a hydration warning.
  const [conversations, setConversations] = React.useState<Conversation[]>(readAll);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  // The debounce timer survives across renders via a ref. We always
  // clear it on the next call AND on unmount.
  const debounceRef = React.useRef<number | null>(null);
  const lastPersistRef = React.useRef<{ id: string; messages: UIMessage[] } | null>(null);

  const persist = React.useCallback(
    (messages: UIMessage[]) => {
      // No active conversation? Nothing to persist. (Caller should call
      // `create()` first if they want to save the current exchange.)
      if (!activeId) return;

      lastPersistRef.current = { id: activeId, messages };

      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        const snapshot = lastPersistRef.current;
        if (!snapshot) return;
        setConversations((prev) => {
          const idx = prev.findIndex((c) => c.id === snapshot.id);
          const updated: Conversation = {
            id: snapshot.id,
            title:
              idx >= 0 && prev[idx]?.title && prev[idx]!.title !== "New chat"
                ? prev[idx]!.title
                : autoTitle(snapshot.messages) || "New chat",
            messages: snapshot.messages,
            createdAt:
              idx >= 0 ? prev[idx]!.createdAt : nowIso(),
            updatedAt: nowIso(),
          };
          let next: Conversation[];
          if (idx >= 0) {
            next = prev.slice();
            next[idx] = updated;
          } else {
            next = [updated, ...prev];
          }
          // Cap the list — oldest first get dropped.
          if (next.length > MAX_CONVERSATIONS) {
            next = next
              .slice()
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .slice(0, MAX_CONVERSATIONS);
          }
          // Newest-first ordering for the UI.
          next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          writeAll(next);
          return next;
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [activeId]
  );

  // Flush the debounced save on unmount so navigating away doesn't drop
  // a partial in-flight write.
  React.useEffect(() => {
    return () => {
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
        const snapshot = lastPersistRef.current;
        if (snapshot) {
          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === snapshot.id);
            const updated: Conversation = {
              id: snapshot.id,
              title:
                idx >= 0 && prev[idx]?.title && prev[idx]!.title !== "New chat"
                  ? prev[idx]!.title
                  : autoTitle(snapshot.messages) || "New chat",
              messages: snapshot.messages,
              createdAt: idx >= 0 ? prev[idx]!.createdAt : nowIso(),
              updatedAt: nowIso(),
            };
            const next = idx >= 0
              ? prev.map((c) => (c.id === snapshot.id ? updated : c))
              : [updated, ...prev];
            next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            writeAll(next);
            return next;
          });
        }
      }
    };
  }, []);

  const get = React.useCallback(
    (id: string): Conversation | null => {
      return conversations.find((c) => c.id === id) ?? null;
    },
    [conversations]
  );

  const create = React.useCallback((): string => {
    const id = makeId();
    const created: Conversation = {
      id,
      title: "New chat",
      messages: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    setConversations((prev) => {
      const next = [created, ...prev];
      writeAll(next);
      return next;
    });
    setActiveId(id);
    log.info({ id }, "chat.history.new");
    return id;
  }, []);

  const remove = React.useCallback(
    (id: string) => {
      log.info({ id }, "chat.history.delete");
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        writeAll(next);
        return next;
      });
      setActiveId((current) => (current === id ? null : current));
    },
    []
  );

  const rename = React.useCallback((id: string, title: string) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx < 0) return prev;
      const next = prev.slice();
      next[idx] = { ...next[idx]!, title, updatedAt: nowIso() };
      writeAll(next);
      return next;
    });
  }, []);

  return {
    conversations,
    activeId,
    get,
    persist,
    setActiveId,
    create,
    remove,
    rename,
  };
}
