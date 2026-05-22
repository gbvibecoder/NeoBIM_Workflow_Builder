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

export const dynamic = "force-dynamic";
// SSE responses are long-running by design; lift the Vercel cap so
// a 10-token-per-second model output doesn't get truncated.
export const maxDuration = 600;

const MAX_MESSAGE_CHARS = 2000;

interface ChatRequestBody {
  conversationId?: string | null;
  message: string;
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
  } catch (err) {
    return formatKosErrorResponse(err);
  }

  // ── SSE stream ───────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const upstream = req.signal;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const generator = runBotTurn({
          tenantId,
          tenantName,
          conversationId: body.conversationId ?? null,
          customerId,
          customerMessage: body.message,
          customerDisplayName,
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
        try {
          controller.close();
        } catch {
          // ignore double-close
        }
      }
    },
    cancel() {
      // Client closed the connection. The for-await loop above
      // notices upstream.aborted on its next iteration.
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
