/**
 * Tests for src/ingestion/scrapers/docs.ts and _shared.ts.
 *
 * The docs scraper fetches the EU AI Act (Articles + Recitals) from
 * https://artificialintelligenceact.eu. We mock the global `fetch` so
 * the tests run offline. We verify:
 *   - HTML is converted to markdown.
 *   - chrome (nav, footer, scripts) is stripped.
 *   - sourceIds are stable and predictable: ai-act/article-N, ai-act/recital-N.
 *   - empty / too-short pages are skipped, not errored.
 *   - non-2xx responses eventually surface (after p-retry gives up on 4xx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";

// Make the test environment predictable.
process.env.VECTOR_BACKEND = "memory";
process.env.DRY_RUN = "";

const RAW_DIR = path.resolve(process.cwd(), "data", "raw");

// We replace `fetch` globally so the scraper doesn't hit the network.
const realFetch = globalThis.fetch;

function mockFetchOnce(responder: (url: string) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    return responder(u);
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

afterEach(async () => {
  globalThis.fetch = realFetch;
  // Force-clear may race with leftover directories from other test files
  // (the issues test writes into data/raw/guidance/ in parallel). Retry once.
  try {
    await rm(RAW_DIR, { recursive: true, force: true });
  } catch {
    await new Promise((r) => setTimeout(r, 50));
    await rm(RAW_DIR, { recursive: true, force: true });
  }
});

describe("docs scraper (EU AI Act)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the first article, converts to markdown, returns a RawDocument", async () => {
    const HTML = `
      <html><head><title>Article 1 - EU AI Act</title></head>
      <body>
        <nav>skip me</nav>
        <script>skip me too</script>
        <main>
          <h1>Article 1 — Subject matter</h1>
          <p>This Regulation lays down harmonised rules on artificial intelligence (the "AI Act") placed on the market or put into service in the Union.</p>
        </main>
        <footer>also skip me</footer>
      </body></html>`;
    mockFetchOnce(() => new Response(HTML, { status: 200 }));

    const { scrapeDocs } = await import("@/ingestion/scrapers/docs");
    const docs = await scrapeDocs({ limit: 1 });
    // limit=1 fetches only the first article. Recitals are skipped at limit=1
    // (recitals are fetched second), so docs has length 1.
    expect(docs).toHaveLength(1);
    expect(docs[0]!.sourceId).toBe("ai-act/article-1");
    expect(docs[0]!.kind).toBe("docs");
    // chrome was stripped, body text was kept
    expect(docs[0]!.text).toContain("Article 1");
    expect(docs[0]!.text).toContain("harmonised rules");
    expect(docs[0]!.text).not.toContain("skip me");
    // Metadata marks it as an article.
    expect(docs[0]!.metadata.kind).toBe("article");
    expect(docs[0]!.metadata.articleNumber).toBe(1);
  });

  it("scrapes recitals when the limit is high enough to reach them", async () => {
    // Per-call responses so the article and recital both get a non-empty body.
    const responder = vi.fn((url: string) => {
      const body = `<html><body><main><p>${"x".repeat(400)} for ${url}</p></main></body></html>`;
      return new Response(body, { status: 200 });
    });
    mockFetchOnce(responder);
    const { scrapeDocs } = await import("@/ingestion/scrapers/docs");
    // Pass a limit that's high enough to include at least one recital.
    // We don't assert a specific count because the order is "all articles,
    // then all recitals"; we just need a recital sourceId to appear.
    const docs = await scrapeDocs({ limit: 120 });
    expect(docs.map((d) => d.sourceId)).toContain("ai-act/recital-1");
  });

  it("skips pages whose markdown is too short (likely JS-only)", async () => {
    mockFetchOnce(() => new Response("<html><body></body></html>", { status: 200 }));
    const { scrapeDocs } = await import("@/ingestion/scrapers/docs");
    const docs = await scrapeDocs({ limit: 1 });
    expect(docs).toHaveLength(0);
  });

  it("logs and continues past a 4xx error", async () => {
    let i = 0;
    mockFetchOnce((url) => {
      i++;
      // 4xx is permanent — p-retry aborts after the first failure
      return new Response("not found", { status: 404, statusText: "Not Found" });
    });
    const { scrapeDocs } = await import("@/ingestion/scrapers/docs");
    const docs = await scrapeDocs({ limit: 3 });
    // p-retry's AbortError is thrown once per page; we log and move on
    expect(docs).toHaveLength(0);
    expect(i).toBeGreaterThanOrEqual(1);
  });
});

describe("htmlToMarkdown helper", () => {
  it("strips scripts, nav, footer", async () => {
    const HTML = `
      <html><body>
        <nav>navigation</nav>
        <script>alert(1)</script>
        <main><p>Real content</p></main>
        <footer>the bottom</footer>
      </body></html>`;
    const { htmlToMarkdown } = await import("@/ingestion/scrapers/_shared");
    const { markdown, title } = htmlToMarkdown(HTML, "https://example.com/");
    expect(markdown).toContain("Real content");
    expect(markdown).not.toContain("navigation");
    expect(markdown).not.toContain("alert(1)");
    expect(markdown).not.toContain("the bottom");
  });

  it("extracts the page title from the head when Readability returns one", async () => {
    const HTML = `<html><head><title>Article 3 - EU AI Act</title></head><body><main><p>${"a".repeat(300)}</p></main></body></html>`;
    const { htmlToMarkdown } = await import("@/ingestion/scrapers/_shared");
    const { title } = htmlToMarkdown(HTML, "https://example.com/");
    expect(title).toBeDefined();
  });
});
