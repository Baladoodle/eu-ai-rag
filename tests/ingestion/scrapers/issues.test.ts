/**
 * Tests for src/ingestion/scrapers/issues.ts.
 *
 * The "issues" scraper is now repurposed for European Commission guidance
 * pages (FAQ, regulatory framework page, GPAI Code of Practice, AI Act
 * Service Desk). The mock setup is a simple HTML page server:
 *   - For each guidance page URL, return a piece of HTML whose body
 *     contains the page title and a few paragraphs.
 *   - We verify the scraper produces RawDocuments with the right
 *     sourceIds, titles, and metadata.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";

const RAW_DIR = path.resolve(process.cwd(), "data", "raw");
const realFetch = globalThis.fetch;

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

afterEach(async () => {
  globalThis.fetch = realFetch;
  // Force-clear may race with leftover directories from other test files
  // (the docs test writes into data/raw/docs/ in parallel). Retry once.
  try {
    await rm(RAW_DIR, { recursive: true, force: true });
  } catch {
    await new Promise((r) => setTimeout(r, 50));
    await rm(RAW_DIR, { recursive: true, force: true });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("guidance scraper (repurposed 'issues')", () => {
  it("scrapes the Commission FAQ and produces a stable sourceId", async () => {
    const HTML = `
      <html><head><title>Navigating the AI Act</title></head>
      <body>
        <main>
          <h1>Navigating the AI Act</h1>
          <p>${"a".repeat(400)}</p>
          <p>Why do we need to regulate AI? Because...</p>
        </main>
      </body></html>`;
    globalThis.fetch = vi.fn(async (url: any) => {
      return htmlResponse(HTML);
    }) as unknown as typeof fetch;

    const { scrapeIssues } = await import("@/ingestion/scrapers/issues");
    const out = await scrapeIssues({ limit: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceId).toBe("ai-act/ec-faq-navigating-ai-act");
    expect(out[0]!.kind).toBe("docs");
    expect(out[0]!.metadata.kind).toBe("guidance");
    expect(out[0]!.text).toContain("regulate AI");
  });

  it("respects the --limit cap and returns that many pages in order", async () => {
    const HTML = `<html><body><main><p>${"x".repeat(400)}</p></main></body></html>`;
    globalThis.fetch = vi.fn(async (url: any) => {
      return htmlResponse(HTML);
    }) as unknown as typeof fetch;

    const { scrapeIssues } = await import("@/ingestion/scrapers/issues");
    const out = await scrapeIssues({ limit: 2 });
    expect(out).toHaveLength(2);
    expect(out[0]!.sourceId).toBe("ai-act/ec-faq-navigating-ai-act");
    expect(out[1]!.sourceId).toBe("ai-act/ec-regulatory-framework");
  });

  it("skips pages whose markdown is too short (likely JS-only)", async () => {
    globalThis.fetch = vi.fn(async () => {
      return htmlResponse("<html><body></body></html>");
    }) as unknown as typeof fetch;

    const { scrapeIssues } = await import("@/ingestion/scrapers/issues");
    const out = await scrapeIssues({ limit: 4 });
    expect(out).toHaveLength(0);
  });
});
