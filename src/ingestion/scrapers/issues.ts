/**
 * ingestion/scrapers/issues.ts
 * ----------------------------------------------------------------------------
 * Scraper for the top GitHub issues on mastra-ai/mastra, sorted by
 * reactions (thumbs-up). We only ingest the original post and the
 * first maintainer reply, not the whole comment thread — the goal is
 * to capture "what real developers asked and how the maintainers
 * answered", not forum noise.
 *
 * Why this exists (educational note for someone new to RAGs):
 *   Real-world developer questions are often slightly different from
 *   what the docs anticipate. Issue threads capture the LONG TAIL of
 *   questions: error messages, edge cases, integrations nobody wrote
 *   a tutorial for. The "answer" is usually short and to the point
 *   (a maintainer doesn't have time to ramble).
 *
 *   This is the "voice of the developer" tier of the KB.
 * ----------------------------------------------------------------------------
 */
import { log } from "@/lib/logger";
import { env } from "@/lib/env";
import type { RawDocument } from "../types";
import { fetchText, persistRaw, slugifyPath } from "./_shared";

const REPO = "mastra-ai/mastra";
const ISSUES_ENDPOINT = `https://api.github.com/repos/${REPO}/issues`;

/** Default count. Override with `INGEST_LIMIT`. */
const DEFAULT_TOP_N = 50;

/**
 * The shape of `GET /repos/:owner/:repo/issues?sort=reactions` is the
 * standard GitHub REST response. We declare only the fields we use to
 * keep the type narrow.
 */
interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  reactions: { total_count: number } | null;
  comments: number;
  user: { login: string } | null;
  labels: ReadonlyArray<{ name: string }>;
  created_at: string;
  /** Set on PRs, absent on issues. Used to filter PRs out. */
  pull_request?: unknown;
}

interface GhComment {
  id: number;
  body: string | null;
  user: { login: string } | null;
  created_at: string;
  /**
   * Maintainers don't have a special role flag in the REST API. We
   * treat the union (issue author OR repo collaborator) as the
   * "maintainer answer". This is a heuristic — a small set of false
   * positives is fine; a small set of false negatives loses us a
   * real answer. We pull the first comment from a non-author user.
   */
  author_association: "OWNER" | "COLLABORATOR" | "MEMBER" | "CONTRIBUTOR" | "NONE";
}

/**
 * Build a stable `sourceId` for an issue. We use the issue number
 * so two ingests of the same issue resolve to the same id (idempotency).
 */
function buildSourceId(issueNumber: number): string {
  return `mastra-issues/issue-${issueNumber}`;
}

function inferTitle(issue: GhIssue): string {
  return issue.title;
}

/**
 * Format one issue as readable text. We don't try to render Markdown
 * — the chunker (MDocument) will handle that for the actual storage
 * representation. Here we just need a single linear string.
 */
function formatIssue(issue: GhIssue, answer: GhComment | null): string {
  const header = `# Issue #${issue.number}: ${issue.title}\n\n`;
  const meta =
    `URL: ${issue.html_url}\n` +
    `Author: ${issue.user?.login ?? "unknown"}\n` +
    `Created: ${issue.created_at}\n` +
    `Reactions: ${issue.reactions?.total_count ?? 0}\n` +
    `Labels: ${issue.labels.map((l) => l.name).join(", ") || "(none)"}\n\n`;
  const body = `## Question\n\n${issue.body ?? "(no body)"}\n`;
  const answerSection = answer
    ? `\n## Maintainer Answer (by @${answer.user?.login ?? "unknown"})\n\n${answer.body ?? ""}\n`
    : "\n## Maintainer Answer\n\n(no maintainer reply found)\n";
  return header + meta + body + answerSection;
}

/**
 * Fetch a JSON URL with auth. We pass the GitHub token if present so
 * the rate limit is 5000/hr instead of 60/hr (the unauthenticated
 * limit). For 60 issues * 2 calls each we're well under the limit
 * either way, but it's free to be polite.
 */
async function fetchJson<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "mastra-expert-ingest",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env.VOYAGE_API_KEY) {
    // We don't have a GH_TOKEN env, so leave it unauthenticated unless
    // someone adds one. The shape of the code is ready.
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText}: ${url}`);
  }
  return (await res.json()) as T;
}

async function fetchIssue(issueNumber: number): Promise<{ issue: GhIssue; answer: GhComment | null }> {
  const issue = await fetchJson<GhIssue>(`${ISSUES_ENDPOINT}/${issueNumber}`);

  // Get the comments, but only the first page (per_page=10) — we only
  // want the first maintainer reply, not the full thread.
  let answer: GhComment | null = null;
  if (issue.comments > 0) {
    const comments = await fetchJson<GhComment[]>(
      `${ISSUES_ENDPOINT}/${issueNumber}/comments?per_page=10`,
    );
    // First comment from someone who isn't the issue author AND has a
    // non-trivial body. We treat "OWNER" / "COLLABORATOR" / "MEMBER"
    // as authoritative; "CONTRIBUTOR" is a stretch but usually right.
    const authorLogin = issue.user?.login;
    answer =
      comments.find(
        (c) =>
          c.body &&
          c.body.trim().length > 20 &&
          c.user?.login !== authorLogin &&
          c.author_association !== "NONE",
      ) ?? null;
  }

  return { issue, answer };
}

/**
 * Get the top N issues by reaction count. We sort client-side
 * (GitHub's `sort=reactions` is by descending total count) and filter
 * out pull requests, which share the `/issues` endpoint.
 */
async function listTopIssues(n: number): Promise<GhIssue[]> {
  const url = `${ISSUES_ENDPOINT}?state=all&per_page=${Math.min(n, 100)}&sort=reactions&direction=desc`;
  const issues = await fetchJson<GhIssue[]>(url);
  return issues
    .filter((i) => !i.pull_request) // exclude PRs
    .filter((i) => i.body && i.body.length > 30) // skip empty/very short
    .sort((a, b) => (b.reactions?.total_count ?? 0) - (a.reactions?.total_count ?? 0))
    .slice(0, n);
}

async function scrapeOne(issue: GhIssue): Promise<RawDocument | null> {
  const { answer } = await fetchIssue(issue.number);
  const text = formatIssue(issue, answer);
  const sourceId = buildSourceId(issue.number);

  const filename = `issue-${issue.number}.md`;
  await persistRaw("issues", filename, text);

  if (text.trim().length < 100) {
    log.warn({ sourceId, len: text.length }, "scrape.issue.empty");
    return null;
  }

  return {
    sourceId,
    url: issue.html_url,
    title: inferTitle(issue),
    text,
    kind: "issue",
    metadata: {
      origin: "github.com/mastra-ai/mastra/issues",
      issueNumber: issue.number,
      reactions: issue.reactions?.total_count ?? 0,
      hasAnswer: answer ? "1" : "0",
      scrapedAt: new Date().toISOString(),
    },
  };
}

/**
 * Scrape the top N issues. Defaults to 50, override with
 * `opts.limit` or the `INGEST_LIMIT` env var.
 */
export async function scrapeIssues(opts: { limit?: number } = {}): Promise<RawDocument[]> {
  const n = opts.limit ?? env.INGEST_LIMIT ?? DEFAULT_TOP_N;

  let top: GhIssue[];
  try {
    top = await listTopIssues(n);
  } catch (err) {
    log.error({ err: String(err) }, "scrape.issues.listFailed");
    return [];
  }

  const out: RawDocument[] = [];
  for (const issue of top) {
    try {
      const doc = await scrapeOne(issue);
      if (doc) {
        out.push(doc);
        log.info(
          { sourceId: doc.sourceId, reactions: doc.metadata.reactions, hasAnswer: doc.metadata.hasAnswer },
          "scrape.issue.page",
        );
      }
    } catch (err) {
      log.error({ err: String(err), issueNumber: issue.number }, "scrape.issue.failed");
    }
  }

  log.info({ scraped: out.length, attempted: top.length }, "scrape.issues.done");
  return out;
}
