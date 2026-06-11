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
 *
 * Why useSyncExternalStore (not useState + useEffect):
 *   localStorage is an external store. React 19's recommended way to
 *   sync with one is `useSyncExternalStore` — it gives us a stable
 *   server snapshot (empty), a stable client snapshot, and a
 *   subscribe/notify pair that works for both cross-tab updates
 *   (the `storage` event) and in-tab updates (our custom
 *   `INTERNAL_EVENT`). A naive `useState(readAll)` runs the
 *   initializer on the server (no window) and the client (real
 *   localStorage) and produces a hydration mismatch.
 * ----------------------------------------------------------------------------
 */
import { isTextUIPart, type UIMessage } from "ai";
import * as React from "react";

import { log } from "@/lib/logger";

const STORAGE_KEY = "eu-ai-act-expert:conversations";
/**
 * Custom event fired after in-tab writes so other useSyncExternalStore
 * subscribers in the same tab re-read localStorage. The native
 * `storage` event only fires across tabs, not within the same tab.
 */
const INTERNAL_EVENT = "eu-ai-act-expert:conversations:update";
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
 * Snapshot cache and stable server snapshot.
 *
 * useSyncExternalStore requires getSnapshot AND getServerSnapshot
 * to return referentially stable values: if the snapshot is `!==`
 * the previous one, React schedules a re-render. Returning a freshly
 * parsed array on every call would therefore cause an infinite
 * re-render loop.
 *
 * - SERVER_SNAPSHOT: a single empty array reused forever.
 * - cachedRaw / cachedParsed: client cache keyed on the raw
 *   localStorage string. When nothing has changed (the user is just
 *   looking at the UI), we return the same array reference. The
 *   cache is invalidated automatically when writeAndStore() writes
 *   new data and dispatches INTERNAL_EVENT, which makes the store
 *   re-read.
 */
const SERVER_SNAPSHOT: Conversation[] = [];

let cachedRaw: string | null | undefined = undefined; // undefined = never read
let cachedParsed: Conversation[] = SERVER_SNAPSHOT;

function parseConversations(raw: string | null): Conversation[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isConversation);
  } catch (error) {
    log.warn({ error: String(error) }, "chat.history.read.failed");
    return [];
  }
}

/**
 * Read all conversations from localStorage. Defensive: returns
 * SERVER_SNAPSHOT (a stable empty array) on any failure or when
 * called on the server.
 */
function readAll(): Conversation[] {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedParsed;
  cachedRaw = raw;
  cachedParsed = parseConversations(raw);
  return cachedParsed;
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
 * Write the full conversation list to storage AND notify in-tab
 * subscribers. The notification is what makes the same-tab
 * useSyncExternalStore consumer re-read the store.
 */
function writeAndStore(conversations: Conversation[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    window.dispatchEvent(new Event(INTERNAL_EVENT));
  } catch (error) {
    log.warn({ error: String(error) }, "chat.history.write.failed");
  }
}

/**
 * Subscribe to localStorage changes. The native `storage` event
 * covers cross-tab updates; the custom INTERNAL_EVENT covers in-tab
 * updates (writes we make ourselves, so other consumers in the same
 * tab re-render).
 */
function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", callback);
  window.addEventListener(INTERNAL_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(INTERNAL_EVENT, callback);
  };
}

function getServerSnapshot(): Conversation[] {
  return SERVER_SNAPSHOT;
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
 * Decide whether a `persist` call represents a real user send (i.e., a
 * new user message) or just a view/stream of an existing conversation.
 *
 * Rule: `updatedAt` only advances when the count of user-role messages
 * strictly grows. Viewing a chat re-loads the same messages (no count
 * delta). Streaming grows the assistant message but the user count
 * is unchanged. Only an actual `send` adds another user message and
 * should bump the timestamp.
 *
 * Why not "compare message arrays": deep equality is O(n) per persist
 * and the AI SDK emits a new array reference on every render. The
 * user-count delta is O(1) and matches the user's intent exactly.
 */
function nextUpdatedAt(
  existing: Conversation | undefined,
  next: ReadonlyArray<UIMessage>,
): string {
  const existingUserCount = existing
    ? existing.messages.filter((m) => m.role === "user").length
    : 0;
  const nextUserCount = next.filter((m) => m.role === "user").length;
  const isUserSend = nextUserCount > existingUserCount;
  if (isUserSend) return nowIso();
  return existing?.updatedAt ?? nowIso();
}

/**
 * Build the next conversations list with one entry replaced/inserted.
 * Pure helper — no side effects, no I/O — so the persist/create/remove
 * call sites stay readable.
 */
function upsertConversation(
  current: ReadonlyArray<Conversation>,
  updated: Conversation,
): Conversation[] {
  const idx = current.findIndex((c) => c.id === updated.id);
  const next =
    idx >= 0
      ? current.map((c) => (c.id === updated.id ? updated : c))
      : [updated, ...current];
  next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (next.length > MAX_CONVERSATIONS) {
    return next.slice(0, MAX_CONVERSATIONS);
  }
  return next;
}

/**
 * React hook. Owns the in-memory mirror of localStorage (via
 * useSyncExternalStore) and exposes the mutation API. Memoised so
 * consumers can safely include returned callbacks in their own
 * `useEffect` deps.
 */
export function useChatHistory(): UseChatHistory {
  // useSyncExternalStore is the React 19 way to sync with an
  // external store. The server snapshot is `[]` (no localStorage on
  // the server), the client snapshot is the parsed localStorage
  // value, and subscribe() covers both cross-tab and in-tab updates.
  // This is the key reason we don't have a hydration mismatch.
  const conversations = React.useSyncExternalStore(
    subscribe,
    readAll,
    getServerSnapshot,
  );

  // activeId is purely React state — it does not survive a refresh
  // and does not need to be in localStorage.
  const [activeId, setActiveId] = React.useState<string | null>(null);

  // Debounce timer survives across renders via a ref. We always
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
        // Read the current list fresh (don't trust the hook's snapshot
        // value — it could be stale if multiple tabs are writing).
        const current = readAll();
        const idx = current.findIndex((c) => c.id === snapshot.id);
        const existing = idx >= 0 ? current[idx] : undefined;
        const updated: Conversation = {
          id: snapshot.id,
          title:
            existing && existing.title && existing.title !== "New chat"
              ? existing.title
              : autoTitle(snapshot.messages) || "New chat",
          messages: snapshot.messages,
          createdAt: existing ? existing.createdAt : nowIso(),
          // Only bumps on a real send. See `nextUpdatedAt` for the
          // rule (view + stream do not advance the timestamp).
          updatedAt: nextUpdatedAt(existing, snapshot.messages),
        };
        const next = upsertConversation(current, updated);
        writeAndStore(next);
      }, SAVE_DEBOUNCE_MS);
    },
    [activeId],
  );

  // Flush the debounced save on unmount so navigating away doesn't
  // drop a partial in-flight write.
  React.useEffect(() => {
    return () => {
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
        const snapshot = lastPersistRef.current;
        if (snapshot) {
          const current = readAll();
          const idx = current.findIndex((c) => c.id === snapshot.id);
          const existing = idx >= 0 ? current[idx] : undefined;
          const updated: Conversation = {
            id: snapshot.id,
            title:
              existing && existing.title && existing.title !== "New chat"
                ? existing.title
                : autoTitle(snapshot.messages) || "New chat",
            messages: snapshot.messages,
            createdAt: existing ? existing.createdAt : nowIso(),
            updatedAt: nextUpdatedAt(existing, snapshot.messages),
          };
          const next = upsertConversation(current, updated);
          writeAndStore(next);
        }
      }
    };
  }, []);

  const get = React.useCallback(
    (id: string): Conversation | null => {
      return conversations.find((c) => c.id === id) ?? null;
    },
    [conversations],
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
    const next = upsertConversation(readAll(), created);
    writeAndStore(next);
    setActiveId(id);
    log.info({ id }, "chat.history.new");
    return id;
  }, []);

  const remove = React.useCallback((id: string) => {
    log.info({ id }, "chat.history.delete");
    const next = readAll().filter((c) => c.id !== id);
    writeAndStore(next);
    setActiveId((current) => (current === id ? null : current));
  }, []);

  const rename = React.useCallback((id: string, title: string) => {
    const current = readAll();
    const idx = current.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const updated: Conversation = {
      ...current[idx]!,
      title,
      updatedAt: nowIso(),
    };
    const next = upsertConversation(current, updated);
    writeAndStore(next);
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
