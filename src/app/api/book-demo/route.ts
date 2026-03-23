import { NextResponse } from "next/server";
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit";
import { sendInboundLeadNotification } from "@/services/email";

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

    // Log to file for analytics
    const fs = await import("fs/promises");
    const path = await import("path");
    const logDir = path.join(process.cwd(), "analytics-logs");
    const logFile = path.join(logDir, "demo-requests.jsonl");
    await fs.mkdir(logDir, { recursive: true });
    await fs.appendFile(
      logFile,
      JSON.stringify({
        type: "book-demo",
        name,
        email,
        phone: phone || null,
        company,
        role: role || null,
        message: message || null,
        timestamp: new Date().toISOString(),
      }) + "\n",
      "utf-8"
    );

    // Send notification email to team
    sendInboundLeadNotification({
      type: "Demo Request",
      name,
      email,
      phone,
      company,
      role,
      message,
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[book-demo] Error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
