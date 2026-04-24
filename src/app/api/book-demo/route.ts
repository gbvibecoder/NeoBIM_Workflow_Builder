import { NextResponse } from "next/server";
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import {
  sendInboundLeadNotification,
  sendDemoRequestConfirmationEmail,
} from "@/shared/services/email";

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = await checkEndpointRateLimit(ip, "book-demo", 3, "1 h");
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const company = typeof body?.company === "string" ? body.company.trim() : "";
    const role = typeof body?.role === "string" ? body.role.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!name || name.length > 200) {
      return NextResponse.json({ error: "Please provide a valid name." }, { status: 400 });
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
    }
    if (!company || company.length > 200) {
      return NextResponse.json({ error: "Please provide a valid company name." }, { status: 400 });
    }

    // Persist to DB — this is the source of truth for the /admin/demo-requests
    // kanban. Vercel's filesystem is read-only so the old JSONL append would
    // drop submissions silently in prod. We still fire-and-forget so a DB
    // hiccup can't take down the form — the team notification email below is
    // a secondary safety net.
    const ua = req.headers.get("user-agent");
    const referer = req.headers.get("referer");
    const utmSource = typeof body?.utmSource === "string" ? body.utmSource.slice(0, 200) : null;
    const utmMedium = typeof body?.utmMedium === "string" ? body.utmMedium.slice(0, 200) : null;
    const utmCampaign = typeof body?.utmCampaign === "string" ? body.utmCampaign.slice(0, 200) : null;

    prisma.demoRequest.create({
      data: {
        name,
        email,
        phone: phone || null,
        company,
        roleTitle: role || null,
        message: message || null,
        ipAddress: ip,
        userAgent: ua ? ua.slice(0, 500) : null,
        referrer: referer ? referer.slice(0, 500) : null,
        utmSource,
        utmMedium,
        utmCampaign,
      },
    }).catch((err) => console.error("[book-demo] Failed to persist demo request", err));

    // Fan out two emails in parallel — neither blocks the HTTP response.
    // 1) Team notification → buildflow786@gmail.com (via TEAM_NOTIFICATION_EMAIL
    //    → CONTACT_EMAIL fallback). Internal lead routing.
    // 2) User confirmation → the submitter's inbox. Acknowledges the request
    //    and sets the 24-hour calendar-invite expectation, so the user has
    //    proof of submission immediately instead of waiting for the rep.
    sendInboundLeadNotification({
      type: "Demo Request",
      name,
      email,
      phone,
      company,
      role,
      message,
    }).catch((err) => console.error("[book-demo] Failed to send team notification email", err));

    sendDemoRequestConfirmationEmail({
      email,
      name,
      company,
      role,
      message,
    }).catch((err) => console.error("[book-demo] Failed to send user confirmation email", err));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[book-demo] Error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
