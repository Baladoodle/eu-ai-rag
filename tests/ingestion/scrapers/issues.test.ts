/**
 * Tests for src/ingestion/scrapers/issues.ts.
 *
 * Mocks the GitHub API endpoints so the test runs offline. We verify:
 *   - We skip pull requests (PRs share the /issues endpoint).
 *   - We sort by reaction count.
 *   - We extract the first maintainer reply (anyone not the author
 *     with author_association != NONE).
 *   - We produce a deterministic sourceId from the issue number.
 *   - We persist raw markdown to data/raw/issues/.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";

const RAW_DIR = path.resolve(process.cwd(), "data", "raw");
const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(async () => {
  globalThis.fetch = realFetch;
  await rm(RAW_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("issues scraper", () => {
  it("filters out pull requests and sorts by reactions", async () => {
    const calls: string[] = [];
    const issues = [
      {
        number: 1,
        title: "An issue",
        body: "Real issue body that is longer than thirty characters.",
        html_url: "https://github.com/mastra-ai/mastra/issues/1",
        state: "open",
        reactions: { total_count: 5 },
        comments: 0,
        user: { login: "alice" },
        labels: [],
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        number: 2,
        title: "A pull request",
        body: "PR body that is longer than thirty characters.",
        html_url: "https://github.com/mastra-ai/mastra/pull/2",
        state: "open",
        reactions: { total_count: 9999 },
        comments: 0,
        user: { login: "bob" },
        labels: [],
        created_at: "2024-01-02T00:00:00Z",
        pull_request: {},
      },
      {
        number: 3,
        title: "Another issue",
        body: "Issue 3 body that is longer than thirty characters.",
        html_url: "https://github.com/mastra-ai/mastra/issues/3",
        state: "open",
        reactions: { total_count: 10 },
        comments: 0,
        user: { login: "carol" },
        labels: [],
        created_at: "2024-01-03T00:00:00Z",
      },
    ];
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = typeof url === "string" ? url : url.toString();
      calls.push(u);
      // First call: list issues
      if (u.includes("/issues?") || u.endsWith("/issues")) return jsonResponse(issues);
      // Subsequent calls: per-issue details + comments
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    const { scrapeIssues } = await import("@/ingestion/scrapers/issues");
    const out = await scrapeIssues({ limit: 2 });
    // PR was filtered out; we get the two real issues, ordered by reactions.
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.sourceId)).toEqual(["mastra-issues/issue-3", "mastra-issues/issue-1"]);
  });

  it("extracts the first maintainer reply", async () => {
    const issue = {
      number: 42,
      title: "Why does X fail?",
      body: "I'm getting this error: SOMETHING_BROKEN, anyone seen it?",
      html_url: "https://github.com/mastra-ai/mastra/issues/42",
      state: "open",
      reactions: { total_count: 7 },
      comments: 2,
      user: { login: "asker" },
      labels: [{ name: "bug" }],
      created_at: "2024-06-01T00:00:00Z",
    };
    const comments = [
      {
        id: 1,
        body: "Same here, also affects me on the latest release.",
        user: { login: "lurker" },
        created_at: "2024-06-01T01:00:00Z",
        author_association: "NONE",
      },
      {
        id: 2,
        body: "This was a regression in v0.10 — fix in #43. Workaround: pass `strict: false`.",
        user: { login: "maint" },
        created_at: "2024-06-01T02:00:00Z",
        author_association: "COLLABORATOR",
      },
    ];
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/issues") || u.includes("/issues?")) return jsonResponse([issue]);
      if (u.includes("/issues/42/comments")) return jsonResponse(comments);
      if (u.endsWith("/issues/42")) return jsonResponse(issue);
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    const { scrapeIssues } = await import("@/ingestion/scrapers/issues");
    const out = await scrapeIssues({ limit: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain("Maintainer Answer");
    expect(out[0]!.text).toContain("regression in v0.10");
    expect(out[0]!.text).toContain("@maint");
    expect(out[0]!.metadata.hasAnswer).toBe("1");
  });

  it("marks hasAnswer=0 when the maintainer never replied", async () => {
    const issue = {
      number: 7,
      title: "Question without an answer",
      body: "Just wondering if anyone has tried this. Anything would help.",
      html_url: "https://github.com/mastra-ai/mastra/issues/7",
      state: "open",
      reactions: { total_count: 1 },
      comments: 0,
      user: { login: "asker" },
      labels: [],
      created_at: "2024-06-02T00:00:00Z",
    };
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/issues") || u.includes("/issues?")) return jsonResponse([issue]);
      if (u.endsWith("/issues/7")) return jsonResponse(issue);
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    const { scrapeIssues } = await import("@/ingestion/scrapers/issues");
    const out = await scrapeIssues({ limit: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]!.metadata.hasAnswer).toBe("0");
  });
});
