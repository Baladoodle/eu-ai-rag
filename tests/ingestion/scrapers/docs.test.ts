/**
 * Tests for src/ingestion/scrapers/docs.ts and _shared.ts.
 *
 * We mock the global `fetch` (and p-retry is a no-op for 200s) so the
 * tests run offline. We verify:
 *   - HTML is converted to markdown.
 *   - chrome (nav, footer, scripts) is stripped.
 *   - sourceIds are stable and predictable.
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
  await rm(RAW_DIR, { recursive: true, force: true });
});

describe("docs scraper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches each doc seed, converts to markdown, returns a RawDocument", async () => {
    const HTML = `
      <html><head><title>RAG Overview - Mastra</title></head>
      <body>
        <nav>skip me</nav>
        <script>skip me too</script>
        <main>
          <h1>RAG Overview</h1>
          <p>Mastra provides a complete RAG pipeline: chunk, embed, retrieve, rerank.</p>
          <pre><code>const doc = MDocument.fromText(text);</code></pre>
        </main>
        <footer>also skip me</footer>
      </body></html>`;
    mockFetchOnce(() => new Response(HTML, { status: 200 }));

    const { scrapeDocs } = await import("@/ingestion/scrapers/docs");
    const docs = await scrapeDocs({ limit: 1 });
    expect(docs).toHaveLength(1);
    expect(docs[0]!.sourceId).toBe("mastra-docs/landing");
    expect(docs[0]!.kind).toBe("docs");
    // chrome was stripped, body text was kept
    expect(docs[0]!.text).toContain("RAG Overview");
    expect(docs[0]!.text).toContain("MDocument.fromText");
    expect(docs[0]!.text).not.toContain("skip me");
  });

  it("uses the path-based sourceId for nested pages", async () => {
    // Per-call responses so each of the 2 seeds gets a non-empty body.
    const responder = vi.fn((url: string) => {
      const body = `<html><body><main><p>${"x".repeat(400)} for ${url}</p></main></body></html>`;
      return new Response(body, { status: 200 });
    });
    mockFetchOnce(responder);
    const { scrapeDocs } = await import("@/ingestion/scrapers/docs");
    const docs = await scrapeDocs({ limit: 2 });
    // limit=2 -> first two seeds, which are landing + rag/overview
    expect(docs.map((d) => d.sourceId)).toContain("mastra-docs/rag/overview");
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
    const HTML = `<html><head><title>My Page Title</title></head><body><main><p>${"a".repeat(300)}</p></main></body></html>`;
    const { htmlToMarkdown } = await import("@/ingestion/scrapers/_shared");
    const { title } = htmlToMarkdown(HTML, "https://example.com/");
    expect(title).toBeDefined();
  });
});
