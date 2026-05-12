/**
 * Server CAPI twin for browser `Contact` events.
 *
 * Mirrors the shape of `/api/track/lead/route.ts` — same fire-and-forget
 * pattern, same cookie/IP/UA forwarding. The browser passes the same
 * `eventId` it used as the pixel's `eventID` option so Meta can dedupe
 * the browser↔server pair.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { trackServerContact } from "@/lib/server-conversions";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const cookieStore = await cookies();
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;

    trackServerContact({
      eventId: body.eventId,
      email: typeof body.email === "string" ? body.email : undefined,
      phone: typeof body.phone === "string" ? body.phone : undefined,
      firstName: typeof body.firstName === "string" ? body.firstName : undefined,
      ip,
      userAgent: req.headers.get("user-agent") || undefined,
      fbp: cookieStore.get("_fbp")?.value,
      fbc: cookieStore.get("_fbc")?.value,
      contentName: typeof body.contentName === "string" ? body.contentName : undefined,
      eventSourceUrl: typeof body.eventSourceUrl === "string" ? body.eventSourceUrl : undefined,
    }).catch((err) => console.warn("[meta-capi-contact]", err));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn("[meta-capi-contact] route error", err);
    return NextResponse.json({ ok: false });
  }
}
