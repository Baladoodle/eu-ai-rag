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
    section: "Definitions",
    text: "Article 3 of Regulation (EU) 2024/1689 sets out the operative definitions used throughout the AI Act. Key definitions include: (1) 'AI system' (Article 3(1)) — a machine-based system that is designed to operate with varying levels of autonomy and that may exhibit adaptiveness after deployment, and that, for explicit or implicit objectives, infers, from the input it receives, how to generate outputs such as predictions, content, recommendations, or decisions that can influence physical or virtual environments. (2) 'provider' (Article 3(3)) — a natural or legal person, public authority, agency or other body that develops an AI system or a general-purpose AI model, or that has an AI system or a general-purpose AI model developed, and places on the market or puts into service that AI system or general-purpose AI model under its own name or trademark, whether for payment or free of charge. (3) 'deployer' (Article 3(4)) — a natural or legal person, public authority, agency or other body using an AI system under its authority, except where the AI system is used in the course of a personal non-professional activity. (4) 'general-purpose AI model' (Article 3(63)) — an AI model that: (a) is trained with self-supervision using a large amount of data, (b) displays significant generality, and (c) can perform a wide range of distinct tasks, including integration in a range of downstream systems or applications. (5) 'systemic risk' (Article 3(65)) — a risk that is specific to the high-impact capabilities of a general-purpose AI model, having a significant impact on the Union market due to its reach, or due to actual or reasonably foreseeable negative effects on public health, safety, public security, fundamental rights, or the society as a whole.",
  },
  {
    id: "ai-act/article-5#chunk-0",
    url: "https://artificialintelligenceact.eu/article/5/",
    title: "Article 5 — Prohibited AI Practices",
    section: "Unacceptable risk",
    text: "Article 5 lists the AI practices that are prohibited in the Union because they are considered to pose an unacceptable risk to fundamental rights. The following AI practices are prohibited: (1) Subliminal, manipulative or deceptive techniques — placing on the market, putting into service, or using an AI system that deploys subliminal techniques beyond a person's consciousness, or purposefully manipulative or deceptive techniques, with the objective or effect of materially distorting the behaviour of a natural person or group by appreciably impairing their ability to make an informed decision, causing significant harm. (2) Exploitation of vulnerabilities — placing on the market, putting into service, or using an AI system that exploits vulnerabilities of a natural person or specific group due to age, disability, or specific social or economic situation, materially distorting behaviour and causing significant harm. (3) Social scoring — placing on the market, putting into service, or using an AI system for the evaluation or classification of the trustworthiness of natural persons or groups over time based on social behaviour or known/predicted personal characteristics, with the social score leading to detrimental or unfavourable treatment. (4) Real-time remote biometric identification — use of a 'real-time remote biometric identification system' in publicly accessible spaces for law enforcement purposes, with limited exceptions. (5) Predictive policing — placing on the market, putting into service, or using AI systems to make risk assessments of natural persons to assess the risk of offending or re-offending, based solely on profiling or personality traits. (6) Untargeted scraping of facial images — placing on the market, putting into service, or using AI systems to create or expand facial recognition databases through the untargeted scraping of facial images from the internet or CCTV. (7) Emotion recognition — placing on the market, putting into service, or using AI systems to infer emotions of natural persons in the workplace and education institutions, except for medical or safety reasons. (8) Biometric categorisation — placing on the market, putting into service, or using AI systems to categorise individuals based on biometric data to deduce or infer race, political opinions, trade union membership, religious beliefs, sex life, or sexual orientation.",
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
    text: "Article 10 requires providers of high-risk AI systems to ensure that the training data, validation data, and testing data sets used to develop the high-risk AI system meet specific quality criteria. The training data, validation data, and testing data sets must be: (1) Relevant — the data sets must be relevant to the intended purpose of the system. (2) Representative — the data sets must be sufficiently representative, and to the best extent possible, free of errors and complete. (3) Bias-free — the data sets must have appropriate statistical properties, including, where applicable, as regards the persons or groups of persons on which the system is intended to be used; the provider must examine and document possible biases in the data sets that could lead to discrimination. (4) Context-appropriate — the data sets must take into account, to the extent required by the intended purpose, the characteristics or elements that are particular to the specific geographical, behavioural, or functional setting within which the system is intended to be used. The training data, validation data, and testing data sets may be processed for the purpose of ensuring bias monitoring and detection.",
  },
  {
    id: "ai-act/article-14#chunk-0",
    url: "https://artificialintelligenceact.eu/article/14/",
    title: "Article 14 — Human Oversight",
    section: "Design for human-in-the-loop",
    text: "Article 14 requires high-risk AI systems to be designed and developed in such a way, including with appropriate human-machine interface tools, that they can be effectively overseen by natural persons during the period in which they are in use. Human oversight must enable the persons to whom oversight is assigned to do the following, as appropriate: (1) properly understand the relevant capacities and limitations of the high-risk AI system, including its explainability; (2) remain aware of the tendency to automatically rely on outputs (automation bias); (3) correctly interpret the high-risk AI system's output, taking into account the system's characteristics and the explanation facilities; (4) decide not to use the high-risk AI system, or to override, reverse, or disregard its output, where the output is not appropriate; (5) intervene on the operation of the high-risk AI system, or interrupt the system through a stop button or similar procedure (intervene). The human oversight measures must be commensurate with the risks, the level of autonomy, and the context of use of the high-risk AI system. Explainability of the system's outputs is a precondition for the human oversight measures to be effective.",
  },
  {
    id: "ai-act/article-16#chunk-0",
    url: "https://artificialintelligenceact.eu/article/16/",
    title: "Article 16 — Provider Obligations",
    section: "Main provider obligations",
    text: "Article 16 sets out the obligations of providers of high-risk AI systems. Providers of high-risk AI systems must comply with Chapter III Section 2 (Articles 8-15), which covers the following requirements: (1) Risk management system (Article 9) — establish a risk management system as a continuous, iterative process run throughout the high-risk AI system's lifecycle. (2) Data and data governance (Article 10) — use training, validation, and testing data sets that meet the quality criteria specified in Article 10. (3) Technical documentation (Article 11 and Annex IV) — draw up and keep up-to-date the technical documentation for the high-risk AI system before placing it on the market or putting it into service. (4) Record-keeping (Article 12) — keep automatic logs (logs generated automatically by the high-risk AI system) for the purpose of ensuring traceability. (5) Transparency and provision of information to deployers (Article 13). (6) Human oversight (Article 14). (7) Accuracy, robustness, and cybersecurity (Article 15). In addition, providers must: have a quality management system in place (Article 17); ensure the system undergoes the relevant conformity assessment procedure (Article 43) before being placed on the market or put into service; draw up an EU declaration of conformity (Article 47); affix the CE marking (Article 48); register the system in the EU database (Article 49); take corrective actions and inform authorities if the system is not in conformity; and establish a post-market monitoring system in accordance with Article 71. The four headline obligations in Chapter III Section 2 — risk management, data governance, technical documentation, and post-market monitoring — are the most-cited substantive obligations of a high-risk AI system provider.",
  },
  {
    id: "ai-act/article-26#chunk-0",
    url: "https://artificialintelligenceact.eu/article/26/",
    title: "Article 26 — Deployer Obligations",
    section: "What deployers must do",
    text: "Article 26 sets out the obligations of deployers of high-risk AI systems. The main deployer obligations are: (1) Use the system in accordance with the instructions for use — deployers must use the high-risk AI system in accordance with the instructions for use accompanying the system. (2) Human oversight — assign human oversight to natural persons with the necessary competence, training, and authority. (3) Input data relevance — ensure that the input data is relevant and sufficiently representative of the operational context. (4) Monitor operation — monitor operation of the high-risk AI system and inform the provider and relevant market surveillance authorities of any serious incident or risk of infringement. (5) Inform workers — inform workers' representatives and the affected workers themselves before putting into service or using a high-risk AI system in the workplace, where the system is to be used for the first time. (6) Fundamental rights impact assessment (FRIA) — where the deployer is a public authority or a private entity providing public services, conduct a fundamental rights impact assessment before putting the high-risk AI system into use. Deployers of certain systems listed in Annex III must also inform natural persons that they are subject to a high-risk AI system and, where applicable, provide a summary of the fundamental rights impact assessment.",
  },
  {
    id: "ai-act/article-50#chunk-0",
    url: "https://artificialintelligenceact.eu/article/50/",
    title: "Article 50 — Transparency Obligations",
    section: "User-facing disclosures",
    text: "Article 50 requires transparency for certain AI systems that interact with natural persons, generate content, or perform specific tasks. Article 50(1) requires that providers of AI systems intended to interact directly with natural persons must design the system in such a way that the affected natural persons are informed that they are interacting with an AI, unless this is obvious from the perspective of a reasonably well-informed natural person taking into account the circumstances and context of use. The information disclosed to natural persons under Article 50(1) must be clear and distinguishable, and provided at the latest at the time of the first interaction or exposure. Article 50(2) requires that providers of AI systems, including general-purpose AI systems, generating synthetic audio, image, video or text content must mark the outputs in a machine-readable way detectable as artificially generated or manipulated, and disclose that the content has been artificially generated or manipulated (AI-generated content disclosure). Article 50(3) requires that deployers of emotion recognition systems or biometric categorisation systems must inform the exposed natural persons of the operation of the system. Article 50(4) requires that deployers of AI systems that generate or manipulate deep fake content must disclose that the content has been artificially generated or manipulated (deep fake disclosure).",
  },
  {
    id: "ai-act/article-55#chunk-0",
    url: "https://artificialintelligenceact.eu/article/55/",
    title: "Article 55 — GPAI Models with Systemic Risk",
    section: "When GPAI crosses the threshold",
    text: "Article 55 applies additional obligations to providers of general-purpose AI models classified as posing systemic risk. The Commission designates a GPAI model as systemic risk if it has high-impact capabilities, presumed when the cumulative compute used for its training exceeds 10^25 FLOPs (10^25 floating-point operations). The threshold is 10^25 FLOPs of training compute. Providers of systemic-risk GPAI models must: (1) Perform model evaluations and document them — perform model evaluations in accordance with state-of-the-art protocols, and document the evaluations. (2) Assess and mitigate possible systemic risks at Union level, including their source. (3) Track and report serious incidents to the AI Office — track serious incidents and possible corrective measures, and report them to the AI Office. (4) Ensure an adequate level of cybersecurity for the model and its physical infrastructure — cybersecurity protection. These obligations are in addition to those in Article 53 (which apply to all GPAI models, including those below the systemic-risk threshold).",
  },
  {
    id: "ai-act/article-99#chunk-0",
    url: "https://artificialintelligenceact.eu/article/99/",
    title: "Article 99 — Penalties",
    section: "Maximum administrative fines",
    text: "Article 99 sets the maximum administrative fines for infringement of the AI Act. Member States must lay down the rules on penalties and notify the Commission by 2 August 2025, taking into account the nature, gravity, and duration of the infringement. The maximum fines are tiered as follows (each is the higher of the absolute amount or the percentage of total worldwide annual turnover of the preceding financial year): (a) 35 million euros (EUR 35 000 000) or 7% of total worldwide annual turnover, whichever is higher, for infringement of Article 5 (prohibited practices); (b) 15 million euros (EUR 15 000 000) or 3% of total worldwide annual turnover, whichever is higher, for non-compliance with most other obligations and requirements of the Act; (c) 7.5 million euros (EUR 7 500 000) or 1% of total worldwide annual turnover, whichever is higher, for supplying incorrect, incomplete, or misleading information to notified bodies or national authorities. The 35 million euro fine (EUR 35 000 000) is the maximum for prohibited AI practices; the 15 million euro fine (EUR 15 000 000) covers most other non-compliance; and the 7.5 million euro fine (EUR 7 500 000) covers information offences. SMEs (including startups) benefit from the lower of the two amounts in each tier (i.e. the percentage of turnover rather than the absolute amount). The maximum fines under Article 99 apply to undertakings, not individuals, and are without prejudice to other supervisory powers or remedies.",
  },
  {
    id: "ai-act/article-4#chunk-0",
    url: "https://artificialintelligenceact.eu/article/4/",
    title: "Article 4 — Approaches to AI Risk",
    section: "Risk taxonomy and proportionality",
    text: "Article 4 sets out the Union's overall approach to AI risk and identifies four risk categories that the Act applies differentially: unacceptable risk (AI practices prohibited under Article 5), high risk (the requirements in Chapter III Section 2 apply), limited risk (the transparency obligations in Article 50 apply), and minimal or no risk (no additional legal obligations beyond existing law). The framework requires that, for each AI system, the risk level be considered in light of the system's intended purpose, the persons or groups affected, and the context of use. Providers and deployers are expected to apply a risk-based approach: the higher the potential impact on fundamental rights, health, or safety, the stricter the obligations. Article 4 is the umbrella provision that ties the specific obligations in Articles 5, 6, and 50 together into a single coherent framework.",
  },
  {
    id: "ai-act/article-43#chunk-0",
    url: "https://artificialintelligenceact.eu/article/43/",
    title: "Article 43 — Conformity Assessment",
    section: "Procedures for high-risk AI systems",
    text: "Article 43 sets out the conformity assessment procedures for high-risk AI systems. Providers must demonstrate that their high-risk AI system complies with the requirements in Chapter III Section 2 (Articles 8-15) before placing it on the market or putting it into service. Three procedures are available, depending on the system: (1) internal control (Annex VI) — the provider self-assesses and drafts the technical documentation, the quality management system, and the EU declaration of conformity; this is the default for most Annex III systems; (2) internal control with notified-body involvement in certain design and development stages (Annex VII), for biometric systems; and (3) examination by a notified body (Annex VII) for AI systems that are safety components of products covered by Union harmonisation legislation listed in Annex I. Certificates issued by notified bodies are valid for a maximum of five years and may be renewed.",
  },
  {
    id: "ai-act/article-49#chunk-0",
    url: "https://artificialintelligenceact.eu/article/49/",
    title: "Article 49 — Registration",
    text: "Article 49 requires providers of high-risk AI systems to register their systems in the EU database established by the Commission before placing on the market or putting into service. Before placing on the market or putting into service a high-risk AI system, the provider of that system must register that system in the EU database for high-risk AI systems (the 'EU database') referred to in Article 71 and Article 73. The Annex VIII technical specifications set out the data fields for the EU database registration and the access rules. The information to be entered in the EU database is set out in Annex VIII. Registration must include the provider's identity, the system's description, its intended purpose, the categories of natural persons affected, and a copy of the user instructions and the EU declaration of conformity. Deployers of certain high-risk systems (in public administration, critical infrastructure, and law enforcement) must also register as deployers in the EU database. The information in the EU database is publicly accessible, subject to exceptions for sensitive data. The Commission maintains the EU database in accordance with the technical specifications set out in Annex VIII.",
  },
  {
    id: "ai-act/article-71#chunk-0",
    url: "https://artificialintelligenceact.eu/article/71/",
    title: "Article 71 — Post-Market Monitoring by Providers",
    section: "Ongoing obligation after placement on the market",
    text: "Article 71 requires providers of high-risk AI systems to establish and document a post-market monitoring system that is proportionate to the nature of the system. The post-market monitoring system must be proactive and systematic: providers must actively and systematically gather, record, and analyse relevant data on the performance of the high-risk AI system throughout its lifetime. The data collected under the post-market monitoring system includes data on interactions with users and other persons, and data on the system's continued compliance with the requirements in Chapter III Section 2. The data must be used to: (a) assess the system's continued conformity with the requirements in Chapter III Section 2; (b) identify any risks to fundamental rights, health, or safety that emerge post-deployment; (c) inform any necessary corrective actions; and (d) feed into the post-market monitoring report to the relevant market surveillance authority. Where the post-market monitoring system reveals a serious incident, the provider must also comply with the incident reporting obligations under Article 72.",
  },
  {
    id: "ai-act/article-72#chunk-0",
    url: "https://artificialintelligenceact.eu/article/72/",
    title: "Article 72 — Reporting of Serious Incidents",
    section: "Notification obligations to market surveillance authorities",
    text: "Article 72 requires providers of high-risk AI systems to report any serious incident to the market surveillance authorities of the Member States where the incident occurred. A 'serious incident' is any incident that directly or indirectly leads to, or might lead to, the death of a person, serious damage to health, serious harm to fundamental rights, or serious damage to property or the environment. The initial report must be made no later than 15 days after the provider becomes aware of the incident (or, in the case of a serious threat, immediately). A final report with the root cause and any corrective actions must follow within one month. Providers must also report to the provider of the AI system (where they are deployers rather than providers) and cooperate with any investigation by the competent authorities.",
  },
  {
    id: "ai-act/article-113#chunk-0",
    url: "https://artificialintelligenceact.eu/article/113/",
    title: "Article 113 — Entry into Force and Application",
    section: "Phased application timeline",
    text: "Article 113 sets out when the AI Act becomes applicable. The Regulation entered into force on 1 August 2024, twenty days after its publication in the Official Journal of the European Union. The provisions of the Act apply in stages: (a) 2 February 2025 — the prohibitions in Article 5 and the general principles in Article 4a apply; (b) 2 August 2025 — the bulk of the Act, including the high-risk system requirements, the transparency obligations, and the GPAI rules, apply; (c) 2 August 2026 — the rules for high-risk systems covered by Annex I (the product-safety legislation) apply; (d) 2 August 2027 — the rules for high-risk systems covered by Annex III that are embedded in regulated products apply for the first time. The Act applies directly in all Member States without requiring national transposition.",
  },
  {
    id: "ai-act/recital-10#chunk-0",
    url: "https://artificialintelligenceact.eu/recital/10/",
    title: "Recital 10 — Relationship with the GDPR",
    section: "Complementarity and lex specialis",
    text: "Recital 10 explains the relationship between the AI Act and Regulation (EU) 2016/679 (the GDPR). The Act is intended to complement the GDPR, not replace it. Personal data processed by AI systems is subject to the GDPR and the Law Enforcement Directive, and the AI Act builds on top of those rules. Where the AI Act overlaps with the GDPR, the AI Act applies as lex specialis (more specific law) and prevails over the general rules of the GDPR for the specific aspects it covers. The supervisory authorities for the AI Act are the same national authorities designated under the GDPR (the data protection authorities), and the European Data Protection Board (EDPB) and the European AI Office cooperate on matters that fall under both regimes. The Recital is explicit that the AI Act does not change the lawful basis for processing personal data under the GDPR.",
  },
  {
    id: "ai-act/annex-3#chunk-0",
    url: "https://artificialintelligenceact.eu/annex/3/",
    title: "Annex III — High-Risk AI Use Cases",
    section: "List of high-risk categories under Article 6(2)",
    text: "Annex III enumerates the categories of AI systems that are always considered high-risk under Article 6(2). They are grouped into eight areas: (1) biometric identification, categorisation, and emotion recognition; (2) management and operation of critical infrastructure (water, gas, electricity, traffic, digital infrastructure); (3) education and vocational training (admissions, assessment, proctoring); (4) employment, workers' management, and self-employment (recruitment, evaluation, termination); (5) access to and use of essential private and public services and benefits (credit scoring, insurance pricing, emergency services); (6) law enforcement (risk assessment, polygraphs, evidence reliability evaluation); (7) migration, asylum, and border control management (risk assessment, examination of applications, identification); and (8) administration of justice and democratic processes (judicial decision support, voting advice, voter targeting). The Commission is required to review and update this list at least once a year.",
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
