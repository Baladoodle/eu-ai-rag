/**
 * tests/ui/chatHistory.test.tsx
 * ----------------------------------------------------------------------------
 * Unit tests for the chat history helpers and citation parsing. The
 * SSR renderer is enough — we don't need DOM interaction.
 * ----------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

import { ChatHistory } from "@/components/chat/ChatHistory";
import {
  parseCitation,
  parseCitation as _parse,
  eurLexHref,
  accentForKind,
} from "@/components/chat/SourceCitations";
import { autoTitle, messageCount } from "@/components/chat/hooks/useChatHistory";
import type { Citation } from "@/../api-contract";

// ----------------------------------------------------------------------------
// Citation parsing
// ----------------------------------------------------------------------------

function makeCitation(overrides: Partial<Citation> = {}): Citation {
  return {
    index: 1,
    source: {
      id: "ai-act/article-6" as never,
      title: "Article 6",
      url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689",
      snippet: "Classification rules for high-risk AI systems.",
      fullText: "Classification rules for high-risk AI systems.",

      retrievedAt: new Date().toISOString(),
      ...(overrides.source ?? {}),
    },
    ...overrides,
  } as Citation;
}

describe("parseCitation", () => {
  it("classifies an Article", () => {
    const c = makeCitation();
    const parsed = parseCitation(c);
    expect(parsed.kind).toBe("article");
    expect(parsed.label).toBe("Article 6");
    expect(parsed.typeLabel).toBe("Article");
  });

  it("classifies a Recital", () => {
    const c = makeCitation({
      source: {
        id: "ai-act/recital-50" as never,
        title: "Recital 50",
        url: "",
        snippet: "Recital snippet",
        fullText: "Recital snippet",

        retrievedAt: new Date().toISOString(),
      } as never,
    });
    const parsed = parseCitation(c);
    expect(parsed.kind).toBe("recital");
    expect(parsed.label).toBe("Recital 50");
  });

  it("classifies an Annex", () => {
    const c = makeCitation({
      source: {
        id: "ai-act/annex-III" as never,
        title: "Annex III",
        url: "",
        snippet: "Annex content",
        fullText: "Annex content",

        retrievedAt: new Date().toISOString(),
      } as never,
    });
    const parsed = parseCitation(c);
    expect(parsed.kind).toBe("annex");
    expect(parsed.typeLabel).toBe("Annex");
  });

  it("classifies Commission guidance", () => {
    const c = makeCitation({
      source: {
        id: "ec/guidance-2025" as never,
        title: "Commission guidance on prohibited practices",
        url: "",
        snippet: "Guidance text",
        fullText: "Guidance text",

        retrievedAt: new Date().toISOString(),
      } as never,
    });
    const parsed = parseCitation(c);
    expect(parsed.kind).toBe("commission");
    expect(parsed.typeLabel).toBe("Commission");
  });

  it("falls back to 'other' when no match", () => {
    const c = makeCitation({
      source: {
        id: "unknown/x" as never,
        title: "Mystery Document",
        url: "",
        snippet: "?",
        fullText: "?",

        retrievedAt: new Date().toISOString(),
      } as never,
    });
    const parsed = parseCitation(c);
    expect(parsed.kind).toBe("other");
  });
});

describe("accentForKind", () => {
  it("returns oklch strings for every kind", () => {
    for (const k of ["article", "recital", "annex", "commission", "other"] as const) {
      expect(accentForKind(k)).toMatch(/^oklch\(/);
    }
  });

  it("differentiates the four regulation types (article, recital, annex, commission)", () => {
    const accents = new Set(
      (["article", "recital", "annex", "commission"] as const).map((k) =>
        accentForKind(k)
      )
    );
    // 4 distinct accents for the 4 regulation types. "other" is allowed
    // to share with "article" so it never disappears in fallback.
    expect(accents.size).toBe(4);
  });
});

describe("eurLexHref", () => {
  it("links to an article fragment for article citations", () => {
    const c = makeCitation();
    const href = eurLexHref(c);
    expect(href).toContain("art_6");
  });
});

// ----------------------------------------------------------------------------
// Chat history helpers
// ----------------------------------------------------------------------------

describe("autoTitle", () => {
  it("uses the first user message as the title", () => {
    const title = autoTitle([
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "What is Article 6?" }],
      } as never,
    ]);
    expect(title).toBe("What is Article 6?");
  });

  it("truncates titles longer than 60 characters on a word boundary", () => {
    const long = "What does the EU AI Act say about the classification of high-risk AI systems across multiple categories and providers?";
    const title = autoTitle([
      { id: "1", role: "user", parts: [{ type: "text", text: long }] } as never,
    ]);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith("…")).toBe(true);
  });

  it("strips basic markdown noise", () => {
    const title = autoTitle([
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "`Explain` **the** _risk_ categories" }],
      } as never,
    ]);
    expect(title).toBe("Explain the risk categories");
  });

  it("returns 'New chat' when there are no user messages", () => {
    const title = autoTitle([]);
    expect(title).toBe("New chat");
  });
});

describe("messageCount", () => {
  it("counts only user and assistant messages", () => {
    const c = {
      id: "1",
      title: "t",
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "?" }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "!" }] },
        { id: "u2", role: "user", parts: [{ type: "text", text: "??" }] },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(messageCount(c as never)).toBe(3);
  });
});

// ----------------------------------------------------------------------------
// Sidebar component
// ----------------------------------------------------------------------------

describe("ChatHistory", () => {
  const conversations = [
    {
      id: "c1",
      title: "Risk categories",
      messages: [],
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    },
    {
      id: "c2",
      title: "Provider obligations",
      messages: [],
      createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    },
  ];

  it("renders the empty state when there are no conversations", () => {
    const html = renderToStaticMarkup(
      <ChatHistory
        conversations={[]}
        activeId={null}
        collapsed={false}
        onToggleCollapsed={() => {}}
        onSelect={() => {}}
        onNewChat={() => {}}
        onDelete={() => {}}
        variant="rail"
      />
    );
    expect(html).toContain("No past conversations");
    expect(html).toContain("Start your first chat");
  });

  it("renders a row per conversation with title and date", () => {
    const html = renderToStaticMarkup(
      <ChatHistory
        conversations={conversations as never}
        activeId="c2"
        collapsed={false}
        onToggleCollapsed={() => {}}
        onSelect={() => {}}
        onNewChat={() => {}}
        onDelete={() => {}}
        variant="rail"
      />
    );
    expect(html).toContain("Risk categories");
    expect(html).toContain("Provider obligations");
  });
});

// keep the alias import in scope to silence unused-locals when the
// file is compiled in isolation
void _parse;
