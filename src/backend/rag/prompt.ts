/**
 * src/backend/rag/prompt.ts
 * ----------------------------------------------------------------------------
 * Step 2 of the RAG pipeline: build the system prompt that the LLM sees.
 *
 * Why the prompt is the most important file in a RAG app (educational):
 *   An LLM is a *completion engine*. Given a system prompt + retrieved
 *   context + a user question, it tries to produce the most likely
 *   next token. Without explicit constraints it will *always* lean on
 *   its training data and produce confident-sounding answers that may
 *   have nothing to do with the chunks you retrieved.
 *
 *   The system prompt below is engineered to do three things:
 *     1. Tell the model WHO it is (so its tone and scope are bounded).
 *     2. Tell it to USE ONLY the retrieved context (so it can't
 *        hallucinate from general knowledge).
 *     3. Tell it to CITE sources inline (so the user can verify).
 *     4. Tell it to REFUSE gracefully when there's no useful context
 *        (so "I don't know" is preferred over invention).
 *
 * Why we constrain to the context (the "what if we don't?" thought):
 *   Without the "use only the context" rule, the model will happily
 *   invent plausible-sounding APIs that don't exist in Mastra. The
 *   user can't tell invention from truth unless we force the model
 *   to limit itself to retrieved passages. A few-shot example at the
 *   end of the prompt makes the rule stick — models imitate patterns
 *   better than they follow rules.
 *
 * Why the prompt is *not* just `context + question`:
 *   The model needs to know:
 *     - What to do when the context is empty ("I don't know").
 *     - The expected citation format (`[1]`, `[2]`, ...).
 *     - That short, accurate answers beat long, hand-wavy ones.
 *
 * Why we put the source list *between* the rules and the question:
 *   The model attends most strongly to the start and end of the
 *   system prompt. Putting the rules at the top and the sources
 *   just before the user message gives the citations maximum weight.
 * ----------------------------------------------------------------------------
 */
import type { RetrievedChunk } from "@/lib/vector-store-reader";
import type { Source } from "@/../api-contract";

/**
 * The static part of the system prompt.
 *
 * Why constant-folded:
 *   The model caches the system prefix for ~5 minutes when prompt
 *   caching is enabled. Keeping the rules stable across requests
 *   maximizes cache hit rate and reduces input token cost.
 *
 * Why a multi-paragraph structure with section headers:
 *   Helps the model "address" specific rules in its reasoning. We
 *   also keep tone instructions short — over-long style rules start
 *   to override the substantive constraints.
 */
const SYSTEM_PROMPT_RULES = `You are Mastra Expert, a focused assistant that answers developer questions about the Mastra AI framework.

# Behavior
- Be concise, accurate, and grounded in the provided context.
- Prefer short, runnable code snippets over prose.
- If the question is ambiguous, state the assumption you are making and answer.
- Never invent APIs, function names, or options that aren't in the context.

# Citations (CRITICAL)
- Every factual claim must end with a citation in the form \`[n]\` where \`n\` is the 1-based index of the source you used.
- If multiple sources support a claim, cite all of them: \`[1][2]\`.
- The sources block below is your *only* allowed reference. Do not cite something that isn't in the block.

# Refusal
- If the sources block is empty, or none of the sources answer the user's question, respond EXACTLY with: "I couldn't find that in the Mastra docs. Could you rephrase the question?" — no other text.
- Never speculate. A short, honest "I don't know" is better than a confident wrong answer.

# Output format
- Plain text, no Markdown headers. Code blocks are fine.
- Lead with the answer, then any code, then citations. Do not include a "Sources:" section in your reply — the UI shows sources separately.`;

/**
 * A worked example that shows the model what a *good* answer looks like.
 *
 * Why few-shot:
 *   Showing the model one canonical example is the most reliable way
 *   to teach the citation format and the refusal behavior. We don't
 *   show the source block in the example — the model already knows the
 *   index → source mapping from the live block beneath it.
 */
const FEW_SHOT_EXAMPLE = `
# Example
User: How do I create a pgvector-backed vector store in Mastra?
Assistant: Use \`PgVector\` from \`@mastra/pg\` and pass the connection string [1]. Call \`createIndex({ indexName, dimension: 1024 })\` once before upserting [2].`;

const SYSTEM_PROMPT_INTRO =
  "You are answering a question using ONLY the sources listed below. If a source is not relevant, do not cite it.";

/**
 * The shape of the system prompt and the user-context block.
 *
 * Why we return both separately:
 *   The system prompt is the rules + the sources block. The user-context
 *   block is the user's actual question, optionally preceded by
 *   conversation history (multi-turn). Keeping them split means callers
 *   can attach the system prompt once and stream user turns without
 *   rebuilding the rules every time.
 */
export interface BuiltPrompt {
  /** The full system prompt to send to the LLM. */
  system: string;
  /** The user message that follows the system prompt. */
  userMessage: string;
}

/**
 * Build the system prompt from a list of retrieved chunks.
 *
 * Why a list of chunks, not a list of pre-built `Source` objects:
 *   This function is on the *retrieval* side of the boundary, before
 *   we've assembled UI-facing `Source` objects. It works with the raw
 *   chunks and produces a plain string; citation.ts is responsible for
 *   turning the chunks + metadata into UI-ready `Source` objects.
 *
 * Why we number the sources with `[1]`, `[2]`, ...:
 *   The model is trained on text with bracketed numerals. It's the
 *   most reliable way to get it to produce *exactly* the right
 *   citation format (vs. footnote-style, parenthetical, etc.).
 */
export function buildSystemPrompt(chunks: RetrievedChunk[]): string {
  // Why we still emit the system prompt when chunks is empty:
  //   The rules section is still useful — when retrieval fails, the
  //   rules tell the model to refuse, which is exactly the behavior
  //   we want. We just skip the "## Sources" block.
  const sourcesBlock = buildSourcesBlock(chunks);
  return [SYSTEM_PROMPT_RULES, SYSTEM_PROMPT_INTRO, sourcesBlock, FEW_SHOT_EXAMPLE]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Render the "## Sources" section.
 *
 * Why a numbered list:
 *   Matches the `[1]`, `[2]` format we ask the model to emit. The model
 *   doesn't need a title or URL in the prompt body — those go in the
 *   UI's source panel.
 *
 * Why we cap snippet length:
 *   Long snippets blow up the prompt. We truncate at 1200 chars here
 *   (well above what fits in a citation chip but well below what would
 *   make the system prompt dominate the context window).
 */
function buildSourcesBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "## Sources\n(none retrieved — answer with the exact refusal above)";
  }
  const items = chunks.map((chunk, idx) => {
    const n = idx + 1;
    const snippet = truncate(chunk.text, 1200);
    return `[${n}] ${snippet}`;
  });
  return `## Sources\n${items.join("\n\n")}`;
}

/**
 * Build the user message — just the last user turn, with any prior turns
 * compressed into a brief recap so multi-turn conversations still work
 * without dragging the full history into the prompt.
 *
 * Why a recap instead of the full history:
 *   The system prompt is already large (sources block). Sending the full
 *   chat history would push the context window and dilute the model's
 *   attention on the retrieved context. The recap keeps the *intent* of
 *   the conversation visible without re-sending every prior turn.
 */
export function buildUserMessage(
  latestUserText: string,
  priorTurns: ReadonlyArray<{ role: "user" | "assistant"; text: string }> = [],
): string {
  if (priorTurns.length === 0) return latestUserText;
  const recap = priorTurns
    .map((t) => `${t.role === "user" ? "U" : "A"}: ${truncate(t.text, 200)}`)
    .join("\n");
  return `Conversation recap:\n${recap}\n\nLatest question:\n${latestUserText}`;
}

/**
 * Build the complete prompt pair in one call.
 *
 * Why a convenience function:
 *   Most callers want both pieces together. Centralizing the composition
 *   makes it easy to add things like "include a debug footer" in one
 *   place later.
 */
export function buildPrompt(
  chunks: RetrievedChunk[],
  latestUserText: string,
  priorTurns: ReadonlyArray<{ role: "user" | "assistant"; text: string }> = [],
): BuiltPrompt {
  return {
    system: buildSystemPrompt(chunks),
    userMessage: buildUserMessage(latestUserText, priorTurns),
  };
}

/**
 * Truncate text to N characters, breaking at the nearest space to avoid
 * mid-word cuts.
 *
 * Why a custom truncator:
 *   JavaScript's `String.prototype.slice` is fine for *byte* truncation
 *   but cuts words in half. The model attends to whole words, so we
 *   break at a word boundary whenever possible.
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  // Why fallback to slice.length: short strings with no spaces should
  // still be truncated to the cap rather than left unchanged.
  return `${slice.slice(0, lastSpace > 0 ? lastSpace : slice.length)}…`;
}

/**
 * Truncate a chunk into a UI-friendly `snippet`.
 *
 * Why here, not in citations.ts:
 *   The snippet length policy is coupled to the prompt's character
 *   budget — they're both about "how much of the chunk to show". Putting
 *   them in one file makes the policy reviewable in one place.
 */
export function makeSnippet(text: string, max = 300): string {
  return truncate(text, max);
}

/**
 * Type guard helper so `buildPrompt`'s callers don't have to remember
 * the chunk's shape. Currently a no-op but cheap insurance.
 */
export function isRetrievedChunk(value: unknown): value is RetrievedChunk {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RetrievedChunk).id === "string" &&
    typeof (value as RetrievedChunk).text === "string" &&
    typeof (value as RetrievedChunk).score === "number"
  );
}

// Re-export the Source type so consumers of this file don't have to
// reach into api-contract.ts themselves.
export type { Source };
