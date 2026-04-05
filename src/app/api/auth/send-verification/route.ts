import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { sendVerificationEmail } from "@/services/email";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await checkEndpointRateLimit(ip, "send-verification", 10, "15 m");
    if (!rl.success) {
      return NextResponse.json(
        formatErrorResponse({ title: "Too many requests", message: "Please wait a few minutes before trying again.", code: "RATE_001" }),
        { status: 429 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, name: true, emailVerified: true },
    });

    if (!user) {
      return NextResponse.json(
        formatErrorResponse({ title: "User not found", message: "Your account could not be found.", code: "AUTH_001" }),
        { status: 404 },
      );
    }

    if (user.emailVerified) {
      return NextResponse.json({ error: "Email already verified." }, { status: 400 });
    }

    // Block verification for placeholder phone-registration emails
    if (user.email?.endsWith("@phone.buildflow.app")) {
      return NextResponse.json(
        formatErrorResponse({ title: "No email set", message: "Please add a real email address in your profile settings first.", code: "VAL_001" }),
        { status: 400 },
      );
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Normalize email to lowercase to match verify-email route lookup
    const normalizedEmail = user.email!.trim().toLowerCase();

    // Delete existing verification tokens for this email
    await prisma.verificationToken.deleteMany({
      where: { identifier: `verify:${normalizedEmail}` },
    });

    await prisma.verificationToken.create({
      data: {
        identifier: `verify:${normalizedEmail}`,
        token,
        expires,
      },
    });

    const baseUrl = process.env.NEXTAUTH_URL
      || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
      || "https://trybuildflow.in";
    const verifyUrl = `${baseUrl}/verify-email?token=${token}&email=${encodeURIComponent(normalizedEmail)}`;

    console.info("[send-verification] Sending to:", user.email, "url:", verifyUrl);
    await sendVerificationEmail(user.email, user.name, verifyUrl);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[send-verification] Error:", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
