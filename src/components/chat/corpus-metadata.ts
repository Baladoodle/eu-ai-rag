/**
 * src/components/chat/corpus-metadata.ts
 * ----------------------------------------------------------------------------
 * Static metadata for every document in the EU AI Act RAG corpus.
 *
 * Why a separate client-side table:
 *   The "References" UI section needs to look up articles that the
 *   assistant *mentions by name* (e.g. "Article 5", "Article 50",
 *   "Annex III") so the user can click through to them — even when
 *   those articles are NOT in the retrieved sources for the current
 *   message. The retrieval layer only ships the articles it picked;
 *   we ship the rest of the corpus as a small static map.
 *
 * Why static and not dynamic:
 *   The corpus is hand-curated. New articles need a code change
 *   anyway (the evaluator's `expectedSources` list, the eval runner
 *   fixtures, the corpus fixtures file all need to agree). A static
 *   table keeps the References list consistent across retrieval
 *   results and tests.
 *
 * The shape mirrors `Citation.source` so a reference can be rendered
 * with the same UI as a cited source (just without the `[n]` index).
 */
export interface Reference {
  /** Display number — e.g. "5" for Article 5, "III" for Annex III. */
  number: string;
  /** "Article", "Recital", "Annex", or "Commission". */
  kind: "Article" | "Recital" | "Annex" | "Commission";
  /** Human-readable title. */
  title: string;
  /** Canonical URL — what we open in a new tab. */
  url: string;
}

const ARTICLES: ReadonlyArray<Reference> = [
  { number: "3", kind: "Article", title: "Definitions", url: "https://artificialintelligenceact.eu/article/3/" },
  { number: "4", kind: "Article", title: "Approaches to AI Risk", url: "https://artificialintelligenceact.eu/article/4/" },
  { number: "5", kind: "Article", title: "Prohibited AI Practices", url: "https://artificialintelligenceact.eu/article/5/" },
  { number: "6", kind: "Article", title: "High-Risk Classification", url: "https://artificialintelligenceact.eu/article/6/" },
  { number: "9", kind: "Article", title: "Risk Management System", url: "https://artificialintelligenceact.eu/article/9/" },
  { number: "10", kind: "Article", title: "Data and Data Governance", url: "https://artificialintelligenceact.eu/article/10/" },
  { number: "11", kind: "Article", title: "Technical Documentation", url: "https://artificialintelligenceact.eu/article/11/" },
  { number: "13", kind: "Article", title: "Transparency and Information to Deployers", url: "https://artificialintelligenceact.eu/article/13/" },
  { number: "14", kind: "Article", title: "Human Oversight", url: "https://artificialintelligenceact.eu/article/14/" },
  { number: "16", kind: "Article", title: "Provider Obligations", url: "https://artificialintelligenceact.eu/article/16/" },
  { number: "26", kind: "Article", title: "Deployer Obligations", url: "https://artificialintelligenceact.eu/article/26/" },
  { number: "43", kind: "Article", title: "Conformity Assessment", url: "https://artificialintelligenceact.eu/article/43/" },
  { number: "49", kind: "Article", title: "Registration", url: "https://artificialintelligenceact.eu/article/49/" },
  { number: "50", kind: "Article", title: "Transparency Obligations", url: "https://artificialintelligenceact.eu/article/50/" },
  { number: "55", kind: "Article", title: "GPAI Models with Systemic Risk", url: "https://artificialintelligenceact.eu/article/55/" },
  { number: "71", kind: "Article", title: "Post-Market Monitoring by Providers", url: "https://artificialintelligenceact.eu/article/71/" },
  { number: "72", kind: "Article", title: "Reporting of Serious Incidents", url: "https://artificialintelligenceact.eu/article/72/" },
  { number: "99", kind: "Article", title: "Penalties", url: "https://artificialintelligenceact.eu/article/99/" },
  { number: "113", kind: "Article", title: "Entry into Force and Application", url: "https://artificialintelligenceact.eu/article/113/" },
];

const RECITALS: ReadonlyArray<Reference> = [
  { number: "10", kind: "Recital", title: "Relationship with the GDPR", url: "https://artificialintelligenceact.eu/recital/10/" },
];

const ANNEXES: ReadonlyArray<Reference> = [
  { number: "I", kind: "Annex", title: "Union Harmonisation Legislation", url: "https://artificialintelligenceact.eu/annex/1/" },
  { number: "III", kind: "Annex", title: "High-Risk AI Use Cases", url: "https://artificialintelligenceact.eu/annex/3/" },
  { number: "IV", kind: "Annex", title: "Technical Documentation", url: "https://artificialintelligenceact.eu/annex/4/" },
  { number: "VI", kind: "Annex", title: "Internal Control Procedure", url: "https://artificialintelligenceact.eu/annex/6/" },
  { number: "VII", kind: "Annex", title: "Notified Body Conformity Assessment", url: "https://artificialintelligenceact.eu/annex/7/" },
  { number: "VIII", kind: "Annex", title: "EU Database Registration", url: "https://artificialintelligenceact.eu/annex/8/" },
];

export const ALL_REFERENCES: ReadonlyArray<Reference> = [
  ...ARTICLES,
  ...RECITALS,
  ...ANNEXES,
];

/**
 * Lookup a Reference by its kind + number. Returns `null` if not in
 * the static table (e.g. the model mentioned an Article we haven't
 * added yet, or a typo).
 */
export function findReference(kind: Reference["kind"], number: string): Reference | null {
  for (const r of ALL_REFERENCES) {
    if (r.kind === kind && r.number === number) return r;
  }
  return null;
}
