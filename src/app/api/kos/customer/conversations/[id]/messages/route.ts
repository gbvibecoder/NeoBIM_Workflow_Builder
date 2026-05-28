/**
 * GET /api/kos/customer/conversations/[id]/messages
 *
 * 5I PR 4b2 — Reload-hydration endpoint.
 *
 * Returns the persisted message rows for a conversation owned by the
 * authenticated customer. The chat UI calls this on mount (with the
 * customer's `currentConversationId` from PR 4b1) so refreshing the
 * page restores past turns + ArtifactBubbles with working downloads.
 *
 * C2 boundary: conversation MUST belong to this (tenant, customer)
 * pair. Cross-customer + cross-tenant + truly-not-found all return
 * 404 with the same envelope so existence cannot be probed via
 * differential error codes.
 *
 * BD_HUMAN and SYSTEM messages are filtered out here — the customer
 * UI has no representation for them today (escalation visibility is
 * a future slice). Filter location is the endpoint, not the hook,
 * so the wire payload only contains rows the client can render.
 */

import type { NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosCustomer } from "@/features/kos/services/kos-customer-auth";
import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";
import type { KosCitation } from "@/features/kos/types/chat";
import type {
  KosConversationMessageDto,
  KosConversationMessagesResponse,
} from "@/features/kos/types/conversation-message";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const startedAt = Date.now();

  try {
    const tenant = await requireTenantOrThrow(req);
    const customer = await requireKosCustomer(req, tenant.id);

    // C2 boundary — same 404 envelope for cross-customer, cross-tenant,
    // and truly-not-found. No info leak via error_code differentiation.
    const conversation = await prisma.kosConversation.findFirst({
      where: { id, tenantId: tenant.id, customerId: customer.id },
      select: { id: true },
    });
    if (!conversation) {
      throw new KosError(
        "KOS_CONV_MSG_001",
        "Conversation not found.",
        404,
      );
    }

    let rows;
    try {
      rows = await prisma.kosMessage.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: "asc" },
      });
    } catch (dbErr) {
      throw new KosError(
        "KOS_CONV_MSG_002",
        `Failed to load conversation messages: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        500,
      );
    }

    let filteredCount = 0;
    const messages: KosConversationMessageDto[] = [];
    for (const row of rows) {
      if (row.authorType !== "CUSTOMER" && row.authorType !== "BOT") {
        filteredCount += 1;
        continue;
      }
      const role: "customer" | "bot" =
        row.authorType === "CUSTOMER" ? "customer" : "bot";
      const dto: KosConversationMessageDto = {
        id: row.id,
        role,
        content: row.content,
        timestamp: row.createdAt.getTime(),
      };
      const refs = parseAttachmentRefs(row.attachmentRefs);
      if (refs) dto.attachmentRefs = refs;
      if (role === "bot" && row.citations) {
        dto.citations = row.citations as unknown as KosCitation[];
      }
      messages.push(dto);
    }

    const response: KosConversationMessagesResponse = {
      conversationId: conversation.id,
      messages,
      truncated: false,
    };

    kosLog.info("kos_conv_messages_loaded", {
      tenantId: tenant.id,
      customerId: customer.id,
      conversationId: id,
      messageCount: messages.length,
      filteredCount,
      durationMs: Date.now() - startedAt,
    });

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err) {
    if (err instanceof KosError) {
      return new Response(
        JSON.stringify({ error_code: err.code, message: err.message }),
        {
          status: err.httpStatus,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    kosLog.error("kos_conv_messages_unhandled", {
      conversationId: id,
      err: err instanceof Error ? err.message : String(err),
    });
    return new Response(
      JSON.stringify({
        error_code: "KOS_CONV_MSG_000",
        message: "An unexpected error occurred while loading conversation messages.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// Defensive parser — `attachmentRefs` is a JSONB column so reads come
// back as `unknown`. We never trust the shape and never throw; bad
// data degrades gracefully to "no attachments on this message."
function parseAttachmentRefs(raw: unknown): string[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const strs = raw.filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  return strs.length > 0 ? strs : undefined;
}
