import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await checkEndpointRateLimit(ip, "verify-email", 10, "15 m");
    if (!rl.success) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const { token, email } = await req.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (typeof token !== "string" || !token || !normalizedEmail) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    // Atomic delete-first: consume token in a single operation to prevent race conditions
    const deleted = await prisma.verificationToken.delete({
      where: {
        identifier_token: {
          identifier: `verify:${normalizedEmail}`,
          token,
        },
      },
    }).catch(() => null);

    if (!deleted) {
      return NextResponse.json({ error: "Invalid or expired verification link." }, { status: 400 });
    }

    if (deleted.expires < new Date()) {
      return NextResponse.json({ error: "Verification link has expired. Please request a new one." }, { status: 400 });
    }

    // Mark email as verified
    await prisma.user.updateMany({
      where: { email: normalizedEmail },
      data: { emailVerified: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[verify-email] Error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
