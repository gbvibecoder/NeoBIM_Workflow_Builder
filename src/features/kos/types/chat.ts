/**
 * KOS customer-chat — client-side types (Phase 3B).
 *
 * These mirror the wire shapes emitted by the backend SSE endpoint
 * `POST /api/kos/customer/chat` (see `bot-orchestrator.ts` →
 * `BotEvent` / `BotCitation`). They are duplicated here rather than
 * imported from the orchestrator so that no client bundle ever pulls
 * in `prisma` / the Anthropic SDK via a transitive value import. The
 * shapes MUST stay in lock-step with the orchestrator's exports.
 */

/**
 * One retrieved source backing a `[N]` marker in the bot's answer.
 * Mirrors `BotCitation` in `bot-orchestrator.ts`.
 *
 * NOTE: the wire shape carries NO `index` field. The 1-based marker
 * number is reconstructed client-side by replaying the backend's
 * marker-ordering algorithm — see `lib/kos-citations.ts`.
 */
export interface KosCitation {
  documentId: string;
  chunkId: string;
  pageNum: number | null;
  snippet: string;
  title: string;
}

/**
 * Discriminated union of every event the SSE stream can emit. The
 * `type` is taken from the SSE `event:` line; the payload is the
 * `data:` JSON (the server strips `type` from the payload, so we
 * re-attach it on parse).
 *
 * 5I PR 3 — extended with drawing-progress events. The KosDrawingSseEvent
 * union is imported (type-only, so no transitive server pulls) from the
 * shared wire-format module.
 */
import type { KosDrawingSseEvent } from "@/features/kos/lib/kos-sse-events";

export type KosBotEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; tool: string; input: unknown }
  | { type: "tool_call_result"; tool: string; output: unknown }
  | { type: "citations"; citations: KosCitation[] }
  | { type: "escalation"; reason: string }
  | { type: "done"; messageId: string; conversationId: string }
  | { type: "error"; code: string; message: string }
  | KosDrawingSseEvent;

/** A single rendered turn in the chat transcript. */
export interface UIMessage {
  /** Local UUID for React keys; replaced with the server messageId on `done`. */
  id: string;
  role: "customer" | "bot";
  /** Markdown for bot turns, plain text for customer turns. */
  content: string;
  citations?: KosCitation[];
  /** True while `text_delta` events are still flowing into this message. */
  isStreaming?: boolean;
  isError?: boolean;
  errorCode?: string;
  /** Human-friendly error line shown inline on a failed bot turn. */
  errorText?: string;
  timestamp: number;
  /**
   * 5I PR 3 — drawing IDs the customer attached to this turn (only
   * present on customer messages). Used to spawn ArtifactBubble(s)
   * inline below the message bubble.
   */
  attachmentRefs?: string[];
  /**
   * 5I PR 3 — display info for attachments, captured at send time so
   * the ArtifactBubble can show the filename even after attachments
   * are cleared from the composer.
   */
  attachmentDisplay?: Array<{ drawingId: string; filename: string }>;
}

/** Customer identity as serialized by `POST /api/kos/customer/session/start`. */
export interface KosCustomerView {
  id: string;
  tenantId?: string;
  displayName: string | null;
  isAnonymous: boolean;
  createdAt?: string;
}
