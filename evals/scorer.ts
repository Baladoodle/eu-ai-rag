/**
 * evals/scorer.ts
 * ----------------------------------------------------------------------------
 * Pure scoring functions for the eval runner. No I/O. No logging. Just math.
 *
 * Why pure: easy to unit test, easy to reason about, and the runner is
 * already heavy on side effects (HTTP, files, streams). The scorer is the
 * place where determinism is a feature, not a cost.
 *
 * What we score, per question (0..8 raw, normalized to 0..100):
 *   - source_accuracy   (0..3): how many expected sources appeared in cited URLs.
 *   - topic_coverage    (0..3): how many expected topics appeared in the answer.
 *   - citation_quality  (0..2): are citations present, well-formatted, and
 *                              anchored in the answer text.
 *   - total_raw         (0..8)
 *   - total_normalized  (0..100) = round((total_raw / 8) * 100)
 *
 * Why this breakdown: a good RAG answer is (a) grounded in the right sources,
 * (b) covers the things the user actually asked about, and (c) shows its work
 * with citations the reader can verify. We make each of those axes explicit.
 * ----------------------------------------------------------------------------
 */

/**
 * A citation as captured by the runner. We only need the URL and the snippet;
 * the runner emits them in the order they appeared in the assistant stream.
 */
export interface CapturedCitation {
  url: string;
  title: string;
  snippet: string;
}

/**
 * The full capture for one question: the assistant's final text + the
 * citations it produced.
 */
export interface CapturedAnswer {
  text: string;
  citations: CapturedCitation[];
}

/**
 * One row in the eval set. Mirrors the shape in `evals/questions.json` so the
 * runner can pass cases through with no transformation.
 */
export interface EvalCase {
  id: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  question: string;
  expectedSources: string[];
  expectedTopics: string[];
}

export interface ScoreBreakdown {
  sourceAccuracy: number; // 0..3
  topicCoverage: number; // 0..3
  citationQuality: number; // 0..2
  totalRaw: number; // 0..8
  totalNormalized: number; // 0..100
  notes: string[]; // human-readable, surface in the report
}

const MAX_RAW = 8;

/**
 * Normalize a raw 0..8 score to 0..100. Pure function.
 */
export function normalize(raw: number): number {
  const clamped = Math.max(0, Math.min(MAX_RAW, raw));
  return Math.round((clamped / MAX_RAW) * 100);
}

/**
 * Strip URL fragments, trailing slashes, and lowercase for fuzzy comparison.
 * Two URLs that differ only by a trailing slash or anchor should match.
 */
function normalizeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    return (parsed.host + parsed.pathname).toLowerCase().replace(/\/$/, "");
  } catch {
    // Not a parseable URL — fall back to a plain lowercase compare.
    return u.toLowerCase().trim();
  }
}

/**
 * Score source accuracy: how many of the case's `expectedSources` URLs
 * appear (fuzzy) among the captured citations. 1 point per match, max 3.
 *
 * Why 3 (not the full array length): we cap so a case with 6 expected sources
 * still has a usable spread. We surface the full count in `notes` so the
 * report can show "5/6 expected sources cited".
 */
export function scoreSourceAccuracy(
  expected: string[],
  captured: CapturedCitation[],
): { score: number; hits: number; total: number; matchedUrls: string[] } {
  const capturedNormalized = captured.map((c) => normalizeUrl(c.url));
  const matchedUrls: string[] = [];
  for (const exp of expected) {
    const expNorm = normalizeUrl(exp);
    const hit = capturedNormalized.some((c) => c === expNorm || c.includes(expNorm) || expNorm.includes(c));
    if (hit) matchedUrls.push(exp);
  }
  const score = Math.min(3, matchedUrls.length);
  return { score, hits: matchedUrls.length, total: expected.length, matchedUrls };
}

/**
 * Score topic coverage: how many of the case's `expectedTopics` substrings
 * appear in the assistant's final text (case-insensitive). 1 point per match,
 * max 3.
 *
 * Why substring (not whole-word): we want lenient matching for technical
 * terms that may be hyphenated or camelCased in the answer ("pgvector" vs
 * "pgVector"). The case author's intent is "did the answer mention X", not
 * "did it appear at a specific word boundary".
 */
export function scoreTopicCoverage(
  expected: string[],
  answerText: string,
): { score: number; hits: number; total: number; matchedTopics: string[] } {
  const haystack = answerText.toLowerCase();
  const matchedTopics: string[] = [];
  for (const topic of expected) {
    if (haystack.includes(topic.toLowerCase())) matchedTopics.push(topic);
  }
  const score = Math.min(3, matchedTopics.length);
  return { score, hits: matchedTopics.length, total: expected.length, matchedTopics };
}

/**
 * Score citation quality. 0..2.
 *
 * 2 = citations present AND at least one citation URL appears in the answer
 *     text as a chip / footnote marker (e.g. "[1]", "[2]").
 * 1 = citations present but no inline markers.
 * 0 = no citations at all.
 */
export function scoreCitationQuality(answer: CapturedAnswer): { score: number; notes: string } {
  if (answer.citations.length === 0) {
    return { score: 0, notes: "no citations emitted" };
  }
  const hasMarkers = /\[\d+\]/.test(answer.text);
  if (hasMarkers) {
    return { score: 2, notes: `${answer.citations.length} citation(s) with inline [n] markers` };
  }
  return { score: 1, notes: `${answer.citations.length} citation(s) present, no inline markers` };
}

/**
 * Score one case end-to-end. Returns the full breakdown.
 */
export function scoreCase(caseInput: EvalCase, answer: CapturedAnswer): ScoreBreakdown {
  const sources = scoreSourceAccuracy(caseInput.expectedSources, answer.citations);
  const topics = scoreTopicCoverage(caseInput.expectedTopics, answer.text);
  const quality = scoreCitationQuality(answer);

  const totalRaw = sources.score + topics.score + quality.score;
  const totalNormalized = normalize(totalRaw);

  const notes: string[] = [];
  if (sources.total > 0) {
    notes.push(`sources: ${sources.hits}/${sources.total} expected cited (${sources.score}/3 pts)`);
  }
  if (topics.total > 0) {
    notes.push(`topics: ${topics.hits}/${topics.total} covered (${topics.score}/3 pts)`);
  }
  notes.push(`citations: ${quality.notes} (${quality.score}/2 pts)`);

  return {
    sourceAccuracy: sources.score,
    topicCoverage: topics.score,
    citationQuality: quality.score,
    totalRaw,
    totalNormalized,
    notes,
  };
}

/**
 * Aggregate a list of per-case scores into a top-line report card.
 *
 * Returns:
 *   - overall: 0..100, weighted average of per-case normalized scores.
 *   - perCategory: mean normalized score per category (e.g. "rag": 78).
 *   - perDifficulty: mean normalized score per difficulty level.
 *   - passRate: % of cases with totalRaw >= 5 (i.e. >= 62%).
 *   - topFailures: the 3 cases with the lowest normalized scores.
 */
export interface ReportCard {
  overall: number;
  perCategory: Record<string, number>;
  perDifficulty: Record<"easy" | "medium" | "hard", number>;
  passRate: number;
  topFailures: Array<{ id: string; score: number; question: string }>;
}

export function aggregate(
  cases: EvalCase[],
  scores: Array<{ caseId: string; breakdown: ScoreBreakdown }>,
): ReportCard {
  if (cases.length === 0) {
    return {
      overall: 0,
      perCategory: {},
      perDifficulty: { easy: 0, medium: 0, hard: 0 },
      passRate: 0,
      topFailures: [],
    };
  }

  const byId = new Map(cases.map((c) => [c.id, c]));
  const overall =
    Math.round(
      (scores.reduce((sum, s) => sum + s.breakdown.totalNormalized, 0) / scores.length) * 10,
    ) / 10;

  // Per-category mean.
  const catBuckets = new Map<string, number[]>();
  for (const s of scores) {
    const c = byId.get(s.caseId);
    if (!c) continue;
    const arr = catBuckets.get(c.category) ?? [];
    arr.push(s.breakdown.totalNormalized);
    catBuckets.set(c.category, arr);
  }
  const perCategory: Record<string, number> = {};
  for (const [cat, arr] of catBuckets.entries()) {
    perCategory[cat] = Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
  }

  // Per-difficulty mean.
  const diffBuckets: Record<"easy" | "medium" | "hard", number[]> = {
    easy: [],
    medium: [],
    hard: [],
  };
  for (const s of scores) {
    const c = byId.get(s.caseId);
    if (!c) continue;
    diffBuckets[c.difficulty].push(s.breakdown.totalNormalized);
  }
  const perDifficulty = {
    easy:
      diffBuckets.easy.length === 0
        ? 0
        : Math.round((diffBuckets.easy.reduce((a, b) => a + b, 0) / diffBuckets.easy.length) * 10) / 10,
    medium:
      diffBuckets.medium.length === 0
        ? 0
        : Math.round(
            (diffBuckets.medium.reduce((a, b) => a + b, 0) / diffBuckets.medium.length) * 10,
          ) / 10,
    hard:
      diffBuckets.hard.length === 0
        ? 0
        : Math.round((diffBuckets.hard.reduce((a, b) => a + b, 0) / diffBuckets.hard.length) * 10) / 10,
  };

  const passing = scores.filter((s) => s.breakdown.totalRaw >= 5).length;
  const passRate = Math.round((passing / scores.length) * 100);

  const sortedAsc = [...scores].sort((a, b) => a.breakdown.totalNormalized - b.breakdown.totalNormalized);
  const topFailures = sortedAsc.slice(0, 3).map((s) => ({
    id: s.caseId,
    score: s.breakdown.totalNormalized,
    question: byId.get(s.caseId)?.question ?? "",
  }));

  return { overall, perCategory, perDifficulty, passRate, topFailures };
}
