/**
 * Server CAPI twin for browser `Lead` events.
 *
 * Called fire-and-forget from every client-side `trackLead(...)` callsite.
 * The browser passes the same `eventId` it used as the pixel's `eventID`
 * option, and we forward `_fbp`/`_fbc` cookies plus IP/UA so Meta can
 * deduplicate the two fires against each other.
 *
 * `META_CAPI_ACCESS_TOKEN` absent → CAPI silently no-ops in
 * `sendMetaConversion`; this route still returns 200 so callers don't retry.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { trackServerLead } from "@/lib/server-conversions";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const cookieStore = await cookies();
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;

    // Fire-and-forget — never block the user-facing form on Meta latency.
    trackServerLead({
      eventId: body.eventId,
      email: typeof body.email === "string" ? body.email : undefined,
      phone: typeof body.phone === "string" ? body.phone : undefined,
      firstName: typeof body.firstName === "string" ? body.firstName : undefined,
      ip,
      userAgent: req.headers.get("user-agent") || undefined,
      fbp: cookieStore.get("_fbp")?.value,
      fbc: cookieStore.get("_fbc")?.value,
      contentName: typeof body.contentName === "string" ? body.contentName : undefined,
      value: typeof body.value === "number" ? body.value : undefined,
      currency: typeof body.currency === "string" ? body.currency : undefined,
      eventSourceUrl: typeof body.eventSourceUrl === "string" ? body.eventSourceUrl : undefined,
    }).catch((err) => console.warn("[meta-capi-lead]", err));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn("[meta-capi-lead] route error", err);
    // Never fail the user-facing fetch — Meta CAPI is best-effort instrumentation.
    return NextResponse.json({ ok: false });
  }
}
