/**
 * 5I PR 4b2 — Response shape for
 *   GET /api/kos/customer/conversations/[id]/messages
 *
 * The endpoint maps `KosMessage` rows from the DB into a shape that
 * drops straight into `ChatSurface`'s `messages` state (one DTO field
 * per UIMessage field), so the reload-hydration path needs no
 * runtime translation beyond a thin field-by-field copy.
 *
 * KosMessage.authorType = BD_HUMAN | SYSTEM rows are filtered out
 * server-side — the customer UI has no representation for them
 * (escalation visibility is a future slice).
 */

import type { KosCitation } from "@/features/kos/types/chat";

export interface KosConversationMessageDto {
  id: string;
  role: "customer" | "bot";
  content: string;
  /** Epoch milliseconds — matches UIMessage.timestamp on the client. */
  timestamp: number;
  /**
   * Drawing IDs the customer attached to this turn. Omitted when
   * the DB column was null/empty/malformed (defensive parser at
   * the endpoint). Drives PR 4's useDrawingArtifactHydration so
   * ArtifactBubbles re-render with their Download links on reload.
   */
  attachmentRefs?: string[];
  /** Citations rendered as [N] markers — pass-through from KosMessage.citations. */
  citations?: KosCitation[] | null;
}

export interface KosConversationMessagesResponse {
  conversationId: string;
  messages: KosConversationMessageDto[];
  /**
   * Honesty signal: true if the endpoint truncated the list (e.g. a
   * future pagination layer). PR 4b2 never truncates, so this is
   * always false. Reserved so consumers don't have to learn a new
   * shape when pagination lands.
   */
  truncated: boolean;
}
