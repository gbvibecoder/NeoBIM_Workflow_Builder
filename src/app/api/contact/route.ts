import { NextResponse } from "next/server";
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit";
import { sendInboundLeadNotification } from "@/services/email";

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = await checkEndpointRateLimit(ip, "contact-form", 5, "1 h");
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!name || name.length > 200) {
      return NextResponse.json({ error: "Please provide a valid name." }, { status: 400 });
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
    }
    if (!subject || subject.length > 500) {
      return NextResponse.json({ error: "Please provide a subject." }, { status: 400 });
    }
    if (!message || message.length > 5000) {
      return NextResponse.json({ error: "Please provide a message." }, { status: 400 });
    }

    // Log to file for analytics
    const fs = await import("fs/promises");
    const path = await import("path");
    const logDir = path.join(process.cwd(), "analytics-logs");
    const logFile = path.join(logDir, "contact-submissions.jsonl");
    await fs.mkdir(logDir, { recursive: true });
    await fs.appendFile(
      logFile,
      JSON.stringify({
        type: "contact",
        name,
        email,
        subject,
        message,
        timestamp: new Date().toISOString(),
      }) + "\n",
      "utf-8"
    );

    // Send notification email to team
    sendInboundLeadNotification({
      type: "Contact Form",
      name,
      email,
      subject,
      message,
    }).catch((err) => console.error("[contact] Failed to send notification email", err));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[contact] Error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
