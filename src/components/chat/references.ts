/**
 * src/components/chat/references.ts
 * ----------------------------------------------------------------------------
 * Detect Article / Recital / Annex mentions in assistant text and surface
 * them as "References" in the chat UI.
 *
 * Why a regex-based detector (not a parse of the LLM's structured output):
 *   The assistant emits prose. Even with prompt instructions, it won't
 *   emit a structured "MENTIONS: Article 5, Article 50" block at the end.
 *   The detection has to be on the prose itself.
 *
 * What this module does NOT do:
 *   - It does NOT validate the mention against the corpus. A mention
 *     could be wrong (e.g. the model says "Article 12 requires X" when
 *     Article 12 says nothing of the sort). We surface the mention as a
 *     navigational reference — the user clicks it, sees the real Article
 *     12, and corrects the model themselves.
 *   - It does NOT include Articles that are also in `citedSources`. The
 *     Sources section already shows them with `[n]` chips; including them
 *     in References would be redundant.
 */
import { findReference, type Reference } from "./corpus-metadata";

export interface Mention {
  /** The reference catalog entry. */
  reference: Reference;
  /** The substring in the answer that triggered the mention. */
  matchedText: string;
}

/**
 * Build the cross-boundary identity key the dedup logic uses.
 *
 * Why `kind:number` (not the cited source's URL):
 *   Cited source URLs come from whatever the ingestion pipeline put
 *   there — EUR-Lex for some sources, artificialintelligenceact.eu
 *   for the dev fixtures, ai-act-service-desk.ec.europa.eu for the
 *   live Annex scraper. Comparing URLs would miss every cited
 *   Article 50 because the cited URL doesn't match the corpus
 *   metadata URL for Article 50. Comparing on `kind:number` matches
 *   the article identity, which is what we actually care about.
 */
export function referenceKey(kind: Reference["kind"], number: string): string {
  return `${kind}:${number}`;
}

/**
 * Pattern catalog.
 *
 * Why three separate regexes (one per kind) instead of one big alternation:
 *   `m[1]` then captures cleanly to (digits | roman-numeral | roman-numeral),
 *   and the dispatch to `findReference(kind, number)` is unambiguous.
 *
 * Article number pattern:
 *   Matches "Article 5", "Article 5(1)", "Article 4a", "Articles 5 and 6".
 *   The trailing letter in "Article 4a" is excluded from the captured
 *   number — important because Article 4a in the AI Act is "General
 *   Principles", a different Article than 4.
 *
 * Annex Roman numeral pattern:
 *   Standard regex for Roman numerals up to 3999 — covers Annex I
 *   through Annex MMMCMXCIX. The Act has Annex I through Annex XIII
 *   in our corpus; we don't want this regex to silently break the
 *   day the corpus grows. (The earlier ad-hoc alternation had an
 *   empty-capture bug at Annex XIX+.)
 *
 * Plural forms ("Articles 5 and 6", "Annexes III and IV") are
 * matched by the `s?` in the noun — the assistant writes plurals
 * naturally and we don't want to miss them. Each match captures only
 * the *first* number; the caller iterates over all matches and
 * resolves each. So "Articles 5 and 6" produces one Mention (Article 5);
 * "Articles 5 and Recital 6" produces two (Article 5, Recital 6).
 */
const ARTICLE_RE = /\bArticles?\s+(\d+)/g;
const RECITAL_RE = /\bRecitals?\s+(\d+)/g;
const ROMAN_RE =
  "M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})";
const ANNEX_RE = new RegExp(`\\bAnnexes?\\s+(${ROMAN_RE})\\b`, "g");

/**
 * Walk the text and return every unique corpus Reference mentioned.
 *
 * De-duplicates by `kind:number` so "Article 5 ... Article 5" returns
 * one entry, not two.
 *
 * Order: preserves the order of first appearance, which is what users
 * read top-to-bottom.
 */
export function extractMentions(text: string): Mention[] {
  const seen = new Set<string>();
  const out: Mention[] = [];

  const collect = (
    matches: IterableIterator<RegExpMatchArray>,
    kind: Reference["kind"],
  ) => {
    for (const m of matches) {
      const number = (m[1] ?? "").trim();
      if (!number) continue;
      const ref = findReference(kind, number);
      if (!ref) continue;
      const key = referenceKey(kind, number);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ reference: ref, matchedText: m[0] });
    }
  };

  collect(text.matchAll(ARTICLE_RE), "Article");
  collect(text.matchAll(RECITAL_RE), "Recital");
  collect(text.matchAll(ANNEX_RE), "Annex");
  return out;
}

/**
 * Filter a list of Mentions to only the ones whose corpus article is
 * NOT already represented as a cited source.
 *
 * Why keyed on `kind:number` (not URL):
 *   See the note on `referenceKey`. URL comparison breaks the moment
 *   the ingestion pipeline emits a different host than the corpus
 *   metadata — which it already does for Annexes (EUR-Lex vs
 *   artificialintelligenceact.eu). Comparing the *article identity*
 *   avoids that mismatch.
 */
export function filterToUncited(
  mentions: Mention[],
  citedKeys: ReadonlySet<string>,
): Mention[] {
  return mentions.filter(
    (m) => !citedKeys.has(referenceKey(m.reference.kind, m.reference.number)),
  );
}
