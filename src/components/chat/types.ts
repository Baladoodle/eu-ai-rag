/**
 * chat/types.ts
 * ----------------------------------------------------------------------------
 * Local types for the chat UI. We re-export the canonical `Citation` and
 * `RetrievalMetadata` shapes from the API contract so consumers can
 * import everything from one place.
 *
 * Why this file exists: the AI SDK's `UIDataTypes` is a `type` alias
 * (not an interface), so it cannot be augmented via `declare module "ai"`.
 * Instead, we cast data parts to these types at the read site
 * (see `Message.tsx` and `useChatState.ts`).
 *
 * Mirror the shapes defined in `api-contract.ts` — both files MUST agree.
 * ----------------------------------------------------------------------------
 */
import type { Citation, RetrievalMetadata } from "@/../api-contract";

export type { Citation, RetrievalMetadata };

/**
 * The `data-sources` part payload. Used by `Message.tsx` and any future
 * citation-related components to narrow the part data.
 */
export interface SourcesDataPart {
  citations: Citation[];
  retrieval: RetrievalMetadata;
}

/**
 * The `data-error` part payload.
 */
export interface ErrorDataPart {
  code: string;
  message: string;
}
