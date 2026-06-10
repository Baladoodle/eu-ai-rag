/**
 * src/lib/vector/fixtures.ts
 * ----------------------------------------------------------------------------
 * A small, hand-written set of EU AI Act "documents" used as the seed
 * corpus in dev and in tests when no real embeddings are available.
 *
 * Why this file exists (educational note for someone new to RAGs):
 *   A RAG chatbot with an empty KB is useless. In dev, the user runs
 *   `npm install && npm run dev` long before running the ingest
 *   pipeline. We need a KB that's good enough to demo the chat UX
 *   even when the corpus is empty.
 *
 *   The fixtures are:
 *     1. Real EU AI Act content (paraphrased from the official text).
 *        We never ship copyrighted verbatim quotes — every entry is
 *        written in our own words.
 *     2. Hand-written, not scraped (so we don't depend on a working
 *        ingest pipeline to demo the app).
 *     3. A handful, not hundreds (the local embedder is a hash function;
 *        quality doesn't scale).
 *
 *   The eval runner also falls back to these fixtures when the live
 *   `/api/chat` is unreachable, so the demo path "just works".
 * ----------------------------------------------------------------------------
 */
import { createHash } from "node:crypto";

/**
 * A single fixture: a synthetic document, with the vector we'll use
 * for it. The vector is produced at module-load time by the same
 * hash-based embedder the runtime uses, so retrieval actually works
 * (same embedding function for the query and the corpus).
 */
export interface FixtureDoc {
  id: string;
  vector: number[];
  metadata: {
    url: string;
    title: string;
    section?: string;
    text: string;
    sourceId: string;
    chunkIndex: number;
    totalChunks: number;
  };
}

const LOCAL_DIM = 256;

/**
 * Hash-based local embedder. Mirrors the one in `lib/rag/embed.ts` —
 * duplicated to avoid a circular import (fixtures load at vector-store
 * init time, which is before rag/embed has a chance to be ready).
 */
function localEmbed(text: string): number[] {
  const vec = new Array<number>(LOCAL_DIM).fill(0);
  const tokens = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2),
  );
  for (const token of tokens) {
    const h = createHash("sha256").update(token).digest();
    for (let b = 0; b < 16; b++) {
      const idx = ((h[b * 2] ?? 0) << 8 | (h[b * 2 + 1] ?? 0)) % LOCAL_DIM;
      const sign = ((h[b + 1] ?? 0) & 1) === 0 ? 1 : -1;
      vec[idx] = (vec[idx] ?? 0) + sign * (((h[b] ?? 0) / 255) + 0.2);
    }
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

/**
 * The fixture corpus. Each entry's `text` is what the LLM will see
 * in the "## Sources" block; the `title` is what the UI shows in
 * the source list.
 *
 * Why we mix Articles, Recitals, Annexes, and Commission guidance:
 *   The chatbot should be able to answer both "what does Article 50
 *   require?" (Article lookup) and "how does the Act relate to GDPR?"
 *   (cross-referencing + Recital rationale). The mix is intentional.
 *
 * Why the source IDs mirror the production format:
 *   `ai-act/article-N` and `ai-act/recital-N` are exactly what the
 *   scraper in `docs.ts` will produce, so the eval cases work against
 *   either the fixtures or the production corpus without changes.
 */
const FIXTURE_DOCS: ReadonlyArray<{
  id: string;
  url: string;
  title: string;
  section?: string;
  text: string;
}> = [
  {
    id: "ai-act/article-3#chunk-0",
    url: "https://artificialintelligenceact.eu/article/3/",
    title: "Article 3 — Definitions",
    section: "AI system",
    text: "Under Article 3(1) of Regulation (EU) 2024/1689, an 'AI system' is a machine-based system that is designed to operate with varying levels of autonomy and that may exhibit adaptiveness after deployment, and that, for explicit or implicit objectives, infers, from the input it receives, how to generate outputs such as predictions, content, recommendations, or decisions that can influence physical or virtual environments. Article 3(3) defines a 'provider' as a natural or legal person, public authority, agency or other body that develops an AI system or a general-purpose AI model, or that has one developed, and places it on the market or puts it into service under its own name or trademark. Article 3(4) defines a 'deployer' as a natural or legal person, public authority, agency or other body using an AI system under its authority, except where the AI system is used in the course of a personal non-professional activity.",
  },
  {
    id: "ai-act/article-5#chunk-0",
    url: "https://artificialintelligenceact.eu/article/5/",
    title: "Article 5 — Prohibited AI Practices",
    section: "Unacceptable risk",
    text: "Article 5 lists the AI practices that are prohibited in the Union because they are considered to pose an unacceptable risk to fundamental rights. These include: (a) placing on the market, putting into service, or using an AI system that uses subliminal techniques, manipulative or deceptive techniques, or exploits vulnerabilities of natural persons or specific groups; (b) AI systems that evaluate or classify the trustworthiness of natural persons leading to detrimental or unfavourable treatment (social scoring); (c) real-time remote biometric identification in publicly accessible spaces for law enforcement purposes, with limited exceptions; and (d) AI systems that infer emotions of natural persons in the workplace and education settings, with medical and safety exceptions. Member States may allow exceptions for the biometric identification cases under strict conditions.",
  },
  {
    id: "ai-act/article-6#chunk-0",
    url: "https://artificialintelligenceact.eu/article/6/",
    title: "Article 6 — High-Risk Classification",
    section: "Two paths to high-risk",
    text: "Article 6(1) establishes that an AI system is high-risk if (a) it is intended to be used as a safety component of a product covered by one of the Union harmonisation legislations listed in Annex I, and that product is required to undergo a conformity assessment under those legislations; or (b) it is listed in Annex III. Article 6(2) requires that the high-risk classification in Annex III be reviewed annually. Article 6(3) sets out the conditions for a system listed in Annex III NOT to be considered high-risk: it must not pose a significant risk of harm to the health, safety or fundamental rights of natural persons, and it must not materially influence the outcome of decision-making. The provider must document the assessment, register the system, and provide it on request.",
  },
  {
    id: "ai-act/article-10#chunk-0",
    url: "https://artificialintelligenceact.eu/article/10/",
    title: "Article 10 — Data and Data Governance",
    section: "Data quality for high-risk systems",
    text: "Article 10 requires providers of high-risk AI systems to use training, validation, and testing data sets that meet specific quality criteria. The data sets must be relevant, sufficiently representative, and to the best extent possible, free of errors and complete. They must have appropriate statistical properties, including, where applicable, as regards the persons or groups of persons on which the system is intended to be used. Data sets must take into account, to the extent required by the intended purpose, the characteristics or elements that are particular to the specific geographical, behavioural, or functional setting within which the system is intended to be used. The provider must examine and document possible biases in the data sets that could lead to discrimination.",
  },
  {
    id: "ai-act/article-14#chunk-0",
    url: "https://artificialintelligenceact.eu/article/14/",
    title: "Article 14 — Human Oversight",
    section: "Design for human-in-the-loop",
    text: "Article 14 requires high-risk AI systems to be designed and developed in such a way, including with appropriate human-machine interface tools, that they can be effectively overseen by natural persons during the period in which they are in use. Oversight must enable the persons to: properly understand the capacities and limitations of the system; remain aware of the tendency to automatically rely on outputs; correctly interpret outputs; decide not to use the system or to override, reverse, or disregard its output; and intervene on the system's operation or interrupt it through a stop button or similar procedure. The oversight measures must be commensurate with the risks, the level of autonomy, and the context of use.",
  },
  {
    id: "ai-act/article-16#chunk-0",
    url: "https://artificialintelligenceact.eu/article/16/",
    title: "Article 16 — Provider Obligations",
    section: "Main provider obligations",
    text: "Article 16 sets out the obligations of providers of high-risk AI systems. Providers must: (a) ensure that their high-risk AI systems comply with the requirements in Chapter III Section 2 (Articles 8-15); (b) have a quality management system in place (Article 17); (c) maintain the technical documentation required by Annex IV; (d) keep automatic logs (Article 12); (e) ensure the system undergoes the relevant conformity assessment procedure (Article 43) before being placed on the market or put into service; (f) draw up an EU declaration of conformity (Article 47); (g) affix the CE marking (Article 48); (h) register the system in the EU database (Article 49); (i) take corrective actions and inform authorities if the system is not in conformity; (j) upon request, demonstrate conformity to national authorities; and (k) ensure the system has a level of accuracy, robustness, and cybersecurity consistent with the intended purpose.",
  },
  {
    id: "ai-act/article-26#chunk-0",
    url: "https://artificialintelligenceact.eu/article/26/",
    title: "Article 26 — Deployer Obligations",
    section: "What deployers must do",
    text: "Article 26 sets out the obligations of deployers of high-risk AI systems. Deployers must use the system in accordance with the instructions for use, assign human oversight to natural persons with the necessary competence, ensure the input data is relevant and sufficiently representative, monitor the system's operation for risks, inform the provider and relevant authorities of serious incidents or risk of infringement, and — where the deployer is a public authority or a private entity providing public services — conduct a fundamental rights impact assessment before putting the system into use. Deployers of certain systems listed in Annex III must also inform natural persons that they are subject to a high-risk AI system and, where applicable, provide a summary of the fundamental rights impact assessment.",
  },
  {
    id: "ai-act/article-50#chunk-0",
    url: "https://artificialintelligenceact.eu/article/50/",
    title: "Article 50 — Transparency Obligations",
    section: "User-facing disclosures",
    text: "Article 50 requires transparency for certain AI systems that interact with natural persons, generate content, or perform specific tasks. Providers of AI systems intended to interact directly with natural persons must design the system so that the affected persons are informed that they are interacting with an AI, unless this is obvious from the perspective of a reasonably well-informed natural person. Providers of AI systems that generate synthetic audio, image, video, or text content must mark the outputs in a machine-readable way detectable as artificially generated or manipulated. Deployers of emotion recognition or biometric categorisation systems must inform the exposed persons. Deployers of AI systems that generate or manipulate deep fake content must disclose that the content has been artificially generated or manipulated.",
  },
  {
    id: "ai-act/article-55#chunk-0",
    url: "https://artificialintelligenceact.eu/article/55/",
    title: "Article 55 — GPAI Models with Systemic Risk",
    section: "When GPAI crosses the threshold",
    text: "Article 55 applies additional obligations to providers of general-purpose AI models classified as posing systemic risk. The Commission designates a GPAI model as systemic risk if it has high-impact capabilities, presumed when the cumulative compute used for its training exceeds 10^25 floating-point operations (FLOPs). Providers of systemic-risk GPAI models must: perform model evaluations and document them; assess and mitigate possible systemic risks at Union level, including their source; track and report serious incidents to the AI Office; and ensure an adequate level of cybersecurity for the model and its physical infrastructure. These obligations are in addition to those in Article 53 (which apply to all GPAI models, including those below the systemic-risk threshold).",
  },
  {
    id: "ai-act/article-99#chunk-0",
    url: "https://artificialintelligenceact.eu/article/99/",
    title: "Article 99 — Penalties",
    section: "Maximum administrative fines",
    text: "Article 99 sets the maximum administrative fines for infringement of the AI Act. Member States must lay down the rules on penalties and notify the Commission by 2 August 2025, taking into account the nature, gravity, and duration of the infringement. The maximum fines are: (a) EUR 35 000 000 or 7% of total worldwide annual turnover, whichever is higher, for infringement of Article 5 (prohibited practices); (b) EUR 15 000 000 or 3% of total worldwide annual turnover, whichever is higher, for non-compliance with most other obligations and requirements; (c) EUR 7 500 000 or 1% of total worldwide annual turnover, whichever is higher, for supplying incorrect, incomplete, or misleading information to notified bodies or authorities. SMEs benefit from the lower of the two amounts in each case.",
  },
];

/**
 * Build the fixture corpus: each doc gets a stable id, a vector
 * (via the local embedder), and the metadata the UI displays.
 */
export function buildFixtureCorpus(): FixtureDoc[] {
  return FIXTURE_DOCS.map((doc, i) => ({
    id: doc.id,
    vector: localEmbed(doc.text),
    metadata: {
      url: doc.url,
      title: doc.title,
      ...(doc.section ? { section: doc.section } : {}),
      text: doc.text,
      sourceId: doc.id.split("#")[0] ?? doc.id,
      chunkIndex: i,
      totalChunks: FIXTURE_DOCS.length,
    },
  }));
}
