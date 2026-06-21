/**
 * evals/scorer.ts
 * ----------------------------------------------------------------------------
 * Pure scoring functions for the eval runner. No I/O. No logging. Just math.
 *
 * Why pure: easy to unit test, easy to reason about, and the runner is
 * already heavy on side effects (HTTP, files, streams). The scorer is the
 * place where determinism is a feature, not a cost.
 * What we score, per question (0..9 raw, normalized to 0..100):
 *   - source_accuracy   (0..3): how many expected sources appeared in cited URLs.
 *   - topic_coverage    (0..3): how many expected topics appeared in the answer
 *                              (matched against a list of accepted surface forms).
 *   - citation_quality  (0..2): are citations present, well-formatted, and
 *                              anchored in the answer text.
 *   - enum_fidelity     (0..1): did an enumeration question produce the
 *                              expected number of list items (default ±1).
 *   - total_raw         (0..9)
 *   - total_normalized  (0..100) = round((total_raw / 9) * 100)

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
  /**
   * Operative concepts the answer must cover. Each entry is a `TopicSpec`:
   * either a bare substring (e.g. "post-market monitoring") or an object
   * with a list of accepted surface forms (e.g. { aliases: ["35 million",
   * "EUR 35 000 000", "€35,000,000"] }).
   */
  expectedTopics: Array<string | TopicSpec>;
  /**
   * Optional. When set, the answer's list-item count must match this
   * number within `enumTolerance`. When undefined, the enum-fidelity
   * axis is skipped (the question isn't an enumeration).
   */
  expectedEnumCount?: number;
  /**
   * Optional. Allowed |answer - expected| delta. Defaults to 1 for
   * "main obligations" framing, 0 for explicitly-counted questions.
   */
  enumTolerance?: number;
}

/**
 * A topic the answer must cover. A topic is considered covered if any
 * of its `aliases` appears in the answer text (case-insensitive substring
 * match). This lets the rubric accept UK / US spelling, ISO / short-form
 * currency, parenthetical expansions, and the other surface-form drifts
 * that are inevitable in a legal-domain RAG.
 */
export interface TopicSpec {
  /** One or more substrings. If any appears in the answer, the topic counts as covered. */
  aliases: string[];
}

const isTopicSpec = (t: string | TopicSpec): t is TopicSpec =>
  typeof t === "object" && t !== null && Array.isArray((t as TopicSpec).aliases);

export interface ScoreBreakdown {
  sourceAccuracy: number; // 0..3
  topicCoverage: number;  // 0..3
  citationQuality: number; // 0..2
  enumFidelity: number;   // 0..1 (1 if axis skipped for non-enum case)
  totalRaw: number;        // 0..9
  totalNormalized: number; // 0..100
  notes: string[]; // human-readable, surface in the report
}

// The total possible raw score went 8 → 9 with the addition of the
// `enumFidelity` axis. The passing threshold in `aggregate` moved
// from 5/8 (62.5%) to 6/9 (66.7%) — not a preservation, a small
// upward shift in the gate, which biases the rubric toward
// comprehensive answers over minimal-but-correct ones.
const MAX_RAW = 9;
/**
 * Normalize a raw 0..9 score to 0..100. Pure function.
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
 *
 * Why aliases (not bare substring): the corpus uses UK English, ISO currency
 * formats, and parenthetical unit expansions. A bare substring test punishes
 * the model for reproducing the source faithfully. Aliases let the case
 * author enumerate the acceptable surface forms.
 */
export function scoreTopicCoverage(
  expected: Array<string | TopicSpec>,
  answerText: string,
): { score: number; hits: number; total: number; matchedTopics: string[]; missedTopics: string[] } {
  const haystack = answerText.toLowerCase();
  const matchedTopics: string[] = [];
  const missedTopics: string[] = [];
  for (const raw of expected) {
    const aliases = (isTopicSpec(raw) ? raw.aliases : [raw]) as string[];
    const first = aliases[0] ?? "";
    const hit = aliases.some((a) => haystack.includes(a.toLowerCase()));
    if (hit) matchedTopics.push(first);
    else missedTopics.push(first);
  }
  const score = Math.min(3, matchedTopics.length);
  return { score, hits: matchedTopics.length, total: expected.length, matchedTopics, missedTopics };
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
 * Score enumeration fidelity. 0..1.
 *
 * 1 = answer's list-item count matches `expectedEnumCount` within `tolerance`
 *     OR the axis is skipped (question is not an enumeration).
 * 0 = list length is off by more than tolerance, or no list was emitted
 *     when one was required.
 *
 * Why this is its own axis, not folded into topic_coverage:
 *   topic_coverage checks "did the answer mention the right things". That's
 *   orthogonal to "did the answer include the right *number* of things".
 *   A 6-item answer that hits all 4 expected topics would still pass
 *   topic coverage 3/3, which is exactly the padded-list regression
 *   this axis exists to detect.
 */
export function scoreEnumFidelity(
  expectedEnumCount: number | undefined,
  enumTolerance: number | undefined,
  answerText: string,
): {
  score: number;
  skipped: boolean;
  answerCount: number;
  expected: number;
  tolerance: number;
  note: string;
} {
  if (expectedEnumCount === undefined) {
    return {
      score: 1,
      skipped: true,
      answerCount: 0,
      expected: 0,
      tolerance: 0,
      note: "enum: n/a",
    };
  }
  // Default tolerance: ±1. "Main obligations" questions in legal-domain RAG
  // rarely have an authoritative count in the source, and the model tends to
  // give 4-6 items. ±0 is too strict and rewards padding/omission; ±2 hides
  // gross miscounts. ±1 is the empirical sweet spot.
  const tolerance = enumTolerance ?? 1;
  const answerCount = countListItems(answerText);
  const ok = Math.abs(answerCount - expectedEnumCount) <= tolerance;
  return {
    score: ok ? 1 : 0,
    skipped: false,
    answerCount,
    expected: expectedEnumCount,
    tolerance,
    note: ok
      ? `enum: ${answerCount} item(s), expected ${expectedEnumCount} \u00b1${tolerance}`
      : `enum: ${answerCount} item(s), expected ${expectedEnumCount} \u00b1${tolerance} \u2014 FAIL`,
  };
}

/**
 * Count list items in the answer. Matches:
 *   - "1. ", "2. ", … (Arabic)
 *   - "1) ", "2) ", …
 *   - "a. ", "b. ", … or "a) ", "b) ", … (lowercase lettered — matches
 *     the Article (a)/(b)/(c) convention used in EU AI Act citations)
 *   - "- ", "* ", "• " bullets
 * One match per line. Lines inside fenced code blocks are ignored so a
 * sample list inside ``` ``` doesn't count.
 */
export function countListItems(text: string): number {
  const stripped = text.replace(/```[\s\S]*?```/g, "");
  const re = /(^|\n)\s*(?:\d+[.)]|[a-z][.)]|[-*•])\s+\S/g;
  const matches = stripped.match(re);
  return matches ? matches.length : 0;
}

/**
 * Score one case end-to-end. Returns the full breakdown.
 */
export function scoreCase(caseInput: EvalCase, answer: CapturedAnswer): ScoreBreakdown {
  const sources = scoreSourceAccuracy(caseInput.expectedSources, answer.citations);
  const topics = scoreTopicCoverage(caseInput.expectedTopics, answer.text);
  const quality = scoreCitationQuality(answer);
  const enums = scoreEnumFidelity(
    caseInput.expectedEnumCount,
    caseInput.enumTolerance,
    answer.text,
  );

  const totalRaw = sources.score + topics.score + quality.score + enums.score;
  const totalNormalized = normalize(totalRaw);

  const notes: string[] = [];
  if (sources.total > 0) {
    notes.push(`sources: ${sources.hits}/${sources.total} expected cited (${sources.score}/3 pts)`);
  }
  if (topics.total > 0) {
    notes.push(`topics: ${topics.hits}/${topics.total} covered (${topics.score}/3 pts)`);
  }
  notes.push(`citations: ${quality.notes} (${quality.score}/2 pts)`);
  notes.push(`${enums.note} (${enums.score}/1 pt)`);

  return {
    sourceAccuracy: sources.score,
    topicCoverage: topics.score,
    citationQuality: quality.score,
    enumFidelity: enums.score,
    totalRaw,
    totalNormalized,
    notes,
  };
}

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

  // Pass threshold: 6/9 (66.7%). See the comment near `MAX_RAW` for why
  // we bumped from 5/8 (62.5%) — bias the rubric toward comprehensive
  // answers.
  const passing = scores.filter((s) => s.breakdown.totalRaw >= 6).length;
  const passRate = Math.round((passing / scores.length) * 100);
  const sortedAsc = [...scores].sort((a, b) => a.breakdown.totalNormalized - b.breakdown.totalNormalized);
  const topFailures = sortedAsc.slice(0, 3).map((s) => ({
    id: s.caseId,
    score: s.breakdown.totalNormalized,
    question: byId.get(s.caseId)?.question ?? "",
  }));

  return { overall, perCategory, perDifficulty, passRate, topFailures };
}
