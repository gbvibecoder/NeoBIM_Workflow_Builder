import { NextResponse } from "next/server";
import { getDashboardMetrics, generateDailyReport, trackEvent } from "@/lib/analytics";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors, AuthErrors } from "@/lib/user-errors";

// Client-side event ingestion (fire-and-forget from browser)
export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    // Rate limit: 30 event batches per user/IP per minute
    const limitKey = userId || getClientIp(req);
    const rateLimit = await checkEndpointRateLimit(limitKey, "analytics-ingest", 30, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json({ ok: false }, { status: 429 });
    }

    const body = await req.json();
    const events = body?.events;

    if (!Array.isArray(events) || events.length === 0 || events.length > 50) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    // Process events in background — don't block response
    for (const evt of events) {
      if (typeof evt?.event !== "string") continue;
      trackEvent({
        userId,
        eventName: evt.event as Parameters<typeof trackEvent>[0]["eventName"],
        properties: evt.properties ?? {},
      }).catch(err => console.warn("[analytics]", err));
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const session = await auth();

    // Only allow admins to view analytics
    if (!session?.user?.id || (session.user as { role?: string }).role !== "PLATFORM_ADMIN") {
      return NextResponse.json(formatErrorResponse(AuthErrors.NO_PERMISSION), { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format");

    if (format === "report") {
      const report = await generateDailyReport();
      return NextResponse.json({ report });
    }

    const metrics = await getDashboardMetrics();
    return NextResponse.json(metrics);
  } catch (error) {
    console.error("[analytics/GET]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
