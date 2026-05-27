/**
 * POST /api/kos/customer/chat — Server-Sent Events stream of a bot turn.
 *
 * Auth: requires a valid kos_customer_session cookie. The bot
 * orchestrator persists messages + audit rows on the server; the
 * stream is purely a transport for incremental UI updates.
 *
 * Event format (text/event-stream):
 *   event: <type>\n
 *   data: <JSON.stringify(payload)>\n
 *   \n
 *
 * The <type> mirrors `BotEvent.type`; the data payload is the rest
 * of the event with the `type` field stripped (so the client can
 * dispatch on event name and trust the payload schema).
 *
 * GET → 405. There is nothing useful to GET on this endpoint.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  KosError,
  formatKosErrorResponse,
} from "@/features/kos/lib/kos-errors";
import { prisma } from "@/lib/db";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosCustomer } from "@/features/kos/services/kos-customer-auth";
import {
  type BotEvent,
  runBotTurn,
} from "@/features/kos/services/bot-orchestrator";
import { KOS_CHAT_MAX_ATTACHMENT_REFS } from "@/features/kos/lib/kos-bot-constants";
import { kosLog } from "@/features/kos/lib/kos-logger";
import { startSseKeepalive } from "@/features/kos/services/kos-sse-keepalive";

// 5I PR 3 — SSE comment ping every 15s to keep the connection alive
// past intermediate-proxy idle timeouts (AWS ALB default 60s).
const SSE_KEEPALIVE_INTERVAL_MS = 15_000;

export const dynamic = "force-dynamic";
// SSE responses are long-running by design; lift the Vercel cap so
// a 10-token-per-second model output doesn't get truncated.
export const maxDuration = 600;

const MAX_MESSAGE_CHARS = 2000;

interface ChatRequestBody {
  conversationId?: string | null;
  message: string;
  /**
   * 5I PR 2b — drawing IDs the customer attached this turn. Each must
   * belong to the (tenant, customer) pair of this request; route
   * validates ownership before forwarding to the orchestrator.
   */
  attachmentRefs?: string[];
}

function isChatRequestBody(x: unknown): x is ChatRequestBody {
  if (!x || typeof x !== "object") return false;
  const obj = x as Record<string, unknown>;
  if (typeof obj.message !== "string") return false;
  if (
    obj.conversationId !== undefined &&
    obj.conversationId !== null &&
    typeof obj.conversationId !== "string"
  )
    return false;
  if (obj.attachmentRefs !== undefined) {
    if (!Array.isArray(obj.attachmentRefs)) return false;
    for (const r of obj.attachmentRefs) {
      if (typeof r !== "string" || r.length === 0) return false;
    }
  }
  return true;
}

function sseFrame(event: BotEvent): string {
  // Strip `type` from the payload so the client trusts `event:` for
  // routing and the data is just the payload values.
  const { type, ...rest } = event;
  return `event: ${type}\ndata: ${JSON.stringify(rest)}\n\n`;
}

export async function POST(req: NextRequest) {
  let tenantId: string;
  let tenantName: string;
  let customerId: string;
  let customerDisplayName: string;
  let body: ChatRequestBody;

  // ── Pre-stream validation (these throw via the normal envelope) ──
  try {
    const tenant = await requireTenantOrThrow(req);
    tenantId = tenant.id;
    tenantName = tenant.name;

    const customer = await requireKosCustomer(req, tenantId);
    customerId = customer.id;
    customerDisplayName =
      customer.displayName ?? customer.name ?? "the customer";

    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch (err) {
      throw new KosError(
        "KOS_CHAT_002",
        `Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
        400,
      );
    }
    if (!isChatRequestBody(parsed)) {
      throw new KosError(
        "KOS_CHAT_002",
        "Body must be { conversationId?: string | null, message: string }.",
        400,
      );
    }
    body = parsed;

    const msg = body.message.trim();
    if (msg.length < 1 || msg.length > MAX_MESSAGE_CHARS) {
      throw new KosError(
        "KOS_CHAT_002",
        `Message length must be between 1 and ${MAX_MESSAGE_CHARS} characters; got ${msg.length}.`,
        400,
      );
    }
    body.message = msg;

    // Verify conversation ownership if a conversationId was passed.
    if (body.conversationId) {
      const owned = await prisma.kosConversation.findFirst({
        where: {
          id: body.conversationId,
          tenantId,
          customerId,
        },
        select: { id: true },
      });
      if (!owned) {
        throw new KosError(
          "KOS_CHAT_003",
          `Conversation ${body.conversationId} not found for this customer/tenant.`,
          403,
        );
      }
    }

    // 5I PR 2b — validate attachmentRefs ownership BEFORE streaming.
    // Defect-C2 boundary: each drawingId must belong to THIS (tenant,
    // customer). Single findMany + count check is the cheapest path.
    // Returns 404 (not 403) on miss to avoid leaking existence.
    if (body.attachmentRefs && body.attachmentRefs.length > 0) {
      if (body.attachmentRefs.length > KOS_CHAT_MAX_ATTACHMENT_REFS) {
        throw new KosError(
          "KOS_CHAT_DRAWING_005",
          `attachmentRefs may contain at most ${KOS_CHAT_MAX_ATTACHMENT_REFS} drawings per turn (got ${body.attachmentRefs.length}).`,
          400,
        );
      }
      // De-dupe to prevent count-check bypass via duplicates
      const uniqueRefs = Array.from(new Set(body.attachmentRefs));
      const owned = await prisma.kosCustomerDrawing.findMany({
        where: {
          id: { in: uniqueRefs },
          tenantId,
          customerId,
        },
        select: { id: true },
      });
      if (owned.length !== uniqueRefs.length) {
        // At least one drawingId either doesn't exist, belongs to a
        // different customer, or belongs to a different tenant. 404 to
        // avoid existence leakage.
        throw new KosError(
          "KOS_CHAT_DRAWING_004",
          "One or more attached drawings were not found for the current customer.",
          404,
        );
      }
      body.attachmentRefs = uniqueRefs;
      kosLog.info("kos_chat_attachments_validated", {
        tenantId,
        customerId,
        drawingIds: uniqueRefs,
        count: uniqueRefs.length,
      });
    }
  } catch (err) {
    return formatKosErrorResponse(err);
  }

  // ── SSE stream ───────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const upstream = req.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 5I PR 3 — install the keepalive BEFORE the generator starts.
      // The stop() call in finally clears the interval whether the
      // turn completed cleanly, errored, or was aborted.
      const stopKeepalive = startSseKeepalive(
        controller,
        encoder,
        SSE_KEEPALIVE_INTERVAL_MS,
      );

      try {
        const generator = runBotTurn({
          tenantId,
          tenantName,
          conversationId: body.conversationId ?? null,
          customerId,
          customerMessage: body.message,
          customerDisplayName,
          attachmentRefs: body.attachmentRefs,
        });

        for await (const event of generator) {
          if (upstream.aborted) {
            console.warn(
              "[kos/customer/chat] client disconnected mid-stream — closing.",
            );
            break;
          }
          controller.enqueue(encoder.encode(sseFrame(event)));
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        const code = err instanceof KosError ? err.code : "KOS_BOT_003";
        try {
          controller.enqueue(
            encoder.encode(sseFrame({ type: "error", code, message })),
          );
        } catch {
          // Stream may already be closed by client abort.
        }
      } finally {
        stopKeepalive();
        try {
          controller.close();
        } catch {
          // ignore double-close
        }
      }
    },
    cancel() {
      // Client closed the connection. The for-await loop above
      // notices upstream.aborted on its next iteration. Keepalive
      // is stopped in the start() finally block.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export function GET() {
  return NextResponse.json(
    { error: { code: "KOS_CHAT_007", message: "Use POST." } },
    { status: 405, headers: { Allow: "POST" } },
  );
}
