/**
 * evals/run.ts
 * ----------------------------------------------------------------------------
 * Eval runner: load evals/questions.json, run each case through the RAG,
 * score it, and write a markdown report.
 *
 *   npm run eval                       # uses the live /api/chat route
 *   npm run eval -- --url http://...    # target a deployed instance
 *   npm run eval -- --mock             # use the in-process mock retriever
 *
 * Output:
 *   evals/reports/<timestamp>.md  (a dated snapshot)
 *   evals/reports/latest.md      (always the most recent run)
 *
 * Why timestamp + latest: timestamped files give us a history to diff;
 * "latest.md" is what the README and CI link to. The runner overwrites
 * latest.md on every run.
 *
 * Why we have a --mock path: the RAG pipeline (api-agent + rag-agent +
 * vector-agent) isn't always wired up when the eval infrastructure is
 * first written. The mock path proves the scoring + reporting works
 * end-to-end on day one, and gives downstream agents a known-good
 * target to hit.
 * ----------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  scoreCase,
  aggregate,
  type CapturedAnswer,
  type CapturedCitation,
  type EvalCase,
  type ScoreBreakdown,
  type ReportCard,
} from "./scorer.js";

// ---------- CLI parsing ----------------------------------------------------

interface CliArgs {
  url: string;
  mock: boolean;
  in: string;
  outDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    url: process.env.EVAL_URL ?? "http://localhost:3000",
    mock: process.env.MOCK === "1",
    in: resolve(process.cwd(), "evals", "questions.json"),
    outDir: resolve(process.cwd(), "evals", "reports"),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i]!;
    else if (a === "--mock") args.mock = true;
    else if (a === "--in") args.in = resolve(process.cwd(), argv[++i]!);
    else if (a === "--out") args.outDir = resolve(process.cwd(), argv[++i]!);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npm run eval [-- --url <http://host:port>] [--mock] [--in <file>] [--out <dir>]",
      );
      process.exit(0);
    }
  }
  return args;
}

// ---------- Question loading ----------------------------------------------

interface QuestionsFile {
  version: string;
  description: string;
  cases: EvalCase[];
}

function loadCases(path: string): EvalCase[] {
  if (!existsSync(path)) {
    throw new Error(`Eval file not found at ${path}. Run from the project root.`);
  }
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as QuestionsFile;
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error("Eval file contains no cases.");
  }
  return parsed.cases;
}

// ---------- HTTP adapter ---------------------------------------------------

interface RunResult {
  text: string;
  citations: CapturedCitation[];
  latencyMs: number;
  errorCode?: string;
}

/**
 * Hit a live /api/chat endpoint with one message and capture the SSE parts.
 *
 * NOTE: this is a minimal adapter. When the real chat route is wired up by
 * api-agent, this function will be the only place that knows how to parse
 * its specific SSE framing. For now, it accepts either a flat JSON response
 * (for the mock path) or a UI message stream with `data-sources` parts.
 */
async function callLive(url: string, question: string, timeoutMs = 60_000): Promise<RunResult> {
  const start = Date.now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ id: "u1", role: "user", content: question }],
        sessionId: "eval-runner",
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      return {
        text: "",
        citations: [],
        latencyMs: Date.now() - start,
        errorCode: `HTTP_${res.status}`,
      };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const citations: CapturedCitation[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      // AI SDK UI message stream: each event is "data: <json>\n\n".
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = event.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const part = JSON.parse(payload);
          // AI SDK v6 `toUIMessageStream()` emits incremental
          // `text-delta` parts with a `delta` field (NOT a `text` field).
          // The aggregated `text` part only appears at the end of the
          // message. We accept both so the runner is resilient to SDK
          // version changes.
          if (part.type === "text-delta" && typeof part.delta === "string") {
            text += part.delta;
          } else if (part.type === "text" && typeof part.text === "string") {
            text += part.text;
          } else if (part.type === "data-sources" && part.data?.citations) {
            for (const c of part.data.citations) {
              if (c.source) {
                citations.push({
                  url: c.source.url,
                  title: c.source.title,
                  snippet: c.source.snippet ?? "",
                });
              }
            }
          } else if (part.type === "data-error" && part.data?.code) {
            // Surface stream errors as the run's errorCode so the
            // report shows why a stream produced no text.
            return {
              text,
              citations,
              latencyMs: Date.now() - start,
              errorCode: String(part.data.code),
            };
          }
        } catch {
          // Skip non-JSON lines; the real route may emit other event shapes.
        }
      }
    }
    return { text, citations, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      text: "",
      citations: [],
      latencyMs: Date.now() - start,
      errorCode: err instanceof Error ? err.name : "FETCH_ERROR",
    };
  } finally {
    clearTimeout(t);
  }
}

// ---------- Mock adapter ---------------------------------------------------

/**
 * A deterministic, in-process adapter that mimics the live route well enough
 * to exercise the scorer and the report writer. It does NOT touch the network
 * or the LLM — it just picks the first expected source URL, prefixes the
 * answer with the expected topics, and emits one citation.
 *
 * Why: lets `npm run eval` succeed (with a low but non-zero score) on day
 * one, before the api-agent and rag-agent have shipped. As soon as the real
 * `/api/chat` is up, `--url http://localhost:3000` will use it and produce
 * real scores.
 */
async function callMock(c: EvalCase): Promise<RunResult> {
  const start = Date.now();
  // Simulate a small amount of work so latency numbers look realistic.
  await new Promise((r) => setTimeout(r, 5));
  const topics = c.expectedTopics;
  // Render TopicSpec objects ({aliases: [...]}) as a readable string
  // instead of "[object Object]". The mock is only used for sanity-
  // checking the scorer — the live path is what we actually grade.
  const renderTopic = (t: typeof topics[number]): string =>
    typeof t === "string" ? t : t.aliases.join(" / ");
  const n = c.expectedEnumCount ?? 0;
  const body =
    n > 0
      ? topics
          .slice(0, n)
          .map((t, i) => `${i + 1}. ${renderTopic(t)} [${i + 1}]`)
          .join("\n")
      : `The key things to know are: ${topics.map(renderTopic).join(", ")}. ` +
        `For the official text, see the linked Article / Recital / Annex.`;
  const text = `Sure — about "${c.question}".\n\n${body}`;
  const firstSource = c.expectedSources[0]!;
  const citations: CapturedCitation[] = [
    {
      url: firstSource,
      title: "EU AI Act source (mock citation)",
      snippet: text.slice(0, 200),
    },
  ];
  return { text, citations, latencyMs: Date.now() - start };
}

// ---------- Per-case orchestration ----------------------------------------

interface ScoredCase {
  caseInput: EvalCase;
  answer: CapturedAnswer;
  breakdown: ScoreBreakdown;
  latencyMs: number;
  errorCode?: string;
}

async function runOne(c: EvalCase, args: CliArgs): Promise<ScoredCase> {
  const result = args.mock ? await callMock(c) : await callLive(args.url, c.question);
  const answer: CapturedAnswer = {
    text: result.text,
    citations: result.citations,
  };
  const breakdown = scoreCase(c, answer);
  return {
    caseInput: c,
    answer,
    breakdown,
    latencyMs: result.latencyMs,
    errorCode: result.errorCode,
  };
}

// ---------- Report rendering ---------------------------------------------

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtPctMaybe(n: number | undefined): string {
  return n === undefined ? "—" : fmtPct(n);
}

function renderReport(
  cases: EvalCase[],
  scored: ScoredCase[],
  card: ReportCard,
  meta: { startedAt: string; finishedAt: string; durationMs: number; url: string; mock: boolean },
): string {
  const lines: string[] = [];

  lines.push(`# Eval Report — ${meta.startedAt}`);
  lines.push("");
  lines.push(`> Generated by \`npm run eval\` (${meta.mock ? "mock adapter" : `live: ${meta.url}`}).`);
  lines.push("> Educational guide: see [`evals/README.md`](./README.md).");
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Overall score:** ${fmtPct(card.overall)} (${scored.length} cases)`);
  lines.push(`- **Pass rate:** ${fmtPct(card.passRate)} (cases with raw score >= 6/9)`);
  lines.push(`- **Duration:** ${(meta.durationMs / 1000).toFixed(1)}s`);
  lines.push("");

  lines.push("### By category");
  lines.push("");
  lines.push("| Category | Mean |");
  lines.push("|---|---|");
  for (const [cat, val] of Object.entries(card.perCategory).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${cat} | ${fmtPct(val)} |`);
  }
  lines.push("");

  lines.push("### By difficulty");
  lines.push("");
  lines.push("| Difficulty | Mean |");
  lines.push("|---|---|");
  lines.push(`| easy   | ${fmtPctMaybe(card.perDifficulty.easy)} |`);
  lines.push(`| medium | ${fmtPctMaybe(card.perDifficulty.medium)} |`);
  lines.push(`| hard   | ${fmtPctMaybe(card.perDifficulty.hard)} |`);
  lines.push("");

  // Per-question
  lines.push("## Per-question breakdown");
  lines.push("");
  lines.push(
    "| ID | Category | Difficulty | Question (short) | Sources | Topics | Citations | Raw | Score |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const s of scored) {
    const q = s.caseInput.question;
    const shortQ = q.length > 50 ? q.slice(0, 47) + "..." : q;
    lines.push(
      `| ${s.caseInput.id} | ${s.caseInput.category} | ${s.caseInput.difficulty} | ${shortQ} | ${s.breakdown.sourceAccuracy}/3 | ${s.breakdown.topicCoverage}/3 | ${s.breakdown.citationQuality}/2 | ${s.breakdown.totalRaw}/9 | ${fmtPct(s.breakdown.totalNormalized)} |`,
    );
  }
  lines.push("");

  // Detailed misses
  lines.push("## What was missed");
  lines.push("");
  for (const s of scored) {
    if (s.breakdown.totalNormalized === 100) continue;
    const q = s.caseInput.question;
    lines.push(`### ${s.caseInput.id} — ${q}`);
    lines.push("");
    lines.push(`- Category: ${s.caseInput.category} | Difficulty: ${s.caseInput.difficulty}`);
    lines.push(`- Score: ${s.breakdown.totalRaw}/9 (${fmtPct(s.breakdown.totalNormalized)})`);
    lines.push(`- Latency: ${s.latencyMs}ms${s.errorCode ? ` | error: ${s.errorCode}` : ""}`);
    lines.push(`- Expected sources: ${s.caseInput.expectedSources.join(", ")}`);
    lines.push(`- Cited URLs: ${s.answer.citations.map((c) => c.url).join(", ") || "(none)"}`);
    lines.push(`- Expected topics: ${s.caseInput.expectedTopics.map((t) => (typeof t === "string" ? t : t.aliases.join(" / "))).join(", ")}`);
    const citedText = s.answer.text.replace(/\s+/g, " ").trim();
    lines.push(`- Answer (first 200 chars): ${citedText.slice(0, 200)}${citedText.length > 200 ? "..." : ""}`);
    lines.push("- Notes:");
    for (const note of s.breakdown.notes) lines.push(`  - ${note}`);
    lines.push("");
  }

  // Top failure modes
  if (card.topFailures.length > 0) {
    lines.push("## Top failure modes");
    lines.push("");
    for (const f of card.topFailures) {
      lines.push(`- **${f.id}** (${fmtPct(f.score)}): ${f.question}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    `_Run started ${meta.startedAt}, finished ${meta.finishedAt}. Adapter: ${meta.mock ? "mock" : meta.url}._`,
  );
  lines.push("");
  return lines.join("\n");
}

// ---------- Main ----------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const startedAt = new Date();
  console.log(`[eval] loading cases from ${args.in}`);
  const cases = loadCases(args.in);
  console.log(`[eval] loaded ${cases.length} cases`);

  if (!args.mock) {
    // Friendly connectivity check before we commit to running the full set.
    try {
      const r = await fetch(`${args.url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ id: "p", role: "user", content: "ping" }] }),
      });
      if (!r.ok && r.status !== 405) {
        console.warn(`[eval] warning: ${args.url}/api/chat returned ${r.status}`);
      }
    } catch (err) {
      console.warn(
        `[eval] warning: cannot reach ${args.url}/api/chat (${err instanceof Error ? err.message : String(err)}). ` +
          `Re-run with --mock to use the in-process adapter.`,
      );
    }
  }

  const scored: ScoredCase[] = [];
  for (const c of cases) {
    process.stdout.write(`[eval] ${c.id} (${c.difficulty}, ${c.category}) ... `);
    const s = await runOne(c, args);
    scored.push(s);
    console.log(`${s.breakdown.totalRaw}/9 (${s.breakdown.totalNormalized}%)`);
  }

  const finishedAt = new Date();
  const card = aggregate(
    cases,
    scored.map((s) => ({ caseId: s.caseInput.id, breakdown: s.breakdown })),
  );

  mkdirSync(args.outDir, { recursive: true });
  const ts = finishedAt.toISOString().replace(/[:.]/g, "-");
  const reportPath = join(args.outDir, `${ts}.md`);
  const latestPath = join(args.outDir, `latest.md`);

  const report = renderReport(cases, scored, card, {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    url: args.url,
    mock: args.mock,
  });
  writeFileSync(reportPath, report, "utf8");
  writeFileSync(latestPath, report, "utf8");

  console.log("");
  console.log(`[eval] overall: ${card.overall}% (pass rate ${card.passRate}%)`);
  console.log(`[eval] report:  ${reportPath}`);
  console.log(`[eval] latest:  ${latestPath}`);
}

main().catch((err) => {
  console.error("[eval] fatal:", err);
  process.exit(1);
});
