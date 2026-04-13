import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { trackSignup } from "@/lib/analytics";
import { trackServerSignup } from "@/lib/server-conversions";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { sendVerificationEmail } from "@/shared/services/email";
import { claimReferralCode } from "@/lib/referral";
import {
  formatErrorResponse,
  FormErrors,
  AuthErrors,
  UserErrors
} from "@/lib/user-errors";
import { normalizePhone } from "@/lib/form-validation";

export async function POST(req: NextRequest) {
  try {
    // Rate limit by IP (unauthenticated endpoint)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
    const rateLimit = await checkEndpointRateLimit(ip, "register", 5, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json(
        formatErrorResponse({ title: "Too many attempts", message: "Please wait before trying again.", code: "RATE_LIMITED" }),
        { status: 429 }
      );
    }

    const { name, email, password, source, referralCode, phoneNumber: rawPhone } = await req.json();

    // Validate required fields
    if (!email || !email.trim()) {
      return NextResponse.json(
        formatErrorResponse(FormErrors.REQUIRED_FIELD("email")),
        { status: 400 }
      );
    }

    if (!password || !password.trim()) {
      return NextResponse.json(
        formatErrorResponse(FormErrors.REQUIRED_FIELD("password")),
        { status: 400 }
      );
    }

    // Normalize email: lowercase + trim to prevent case-sensitive lookup mismatches
    const normalizedEmail = email.trim().toLowerCase();

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(normalizedEmail)) {
      return NextResponse.json(
        formatErrorResponse(FormErrors.INVALID_EMAIL),
        { status: 400 }
      );
    }

    // Validate and normalize phone number if provided
    let normalizedPhone: string | null = null;
    if (rawPhone && typeof rawPhone === "string" && rawPhone.trim()) {
      normalizedPhone = normalizePhone(rawPhone);
      if (!normalizedPhone) {
        return NextResponse.json(
          formatErrorResponse(FormErrors.INVALID_PHONE),
          { status: 400 }
        );
      }

      // Check if phone already exists
      const existingPhone = await prisma.user.findUnique({ where: { phoneNumber: normalizedPhone } });
      if (existingPhone) {
        return NextResponse.json(
          formatErrorResponse(AuthErrors.PHONE_ALREADY_EXISTS),
          { status: 409 }
        );
      }
    }

    // Validate password length
    if (password.length < 8) {
      return NextResponse.json(
        formatErrorResponse(FormErrors.PASSWORD_TOO_SHORT),
        { status: 400 }
      );
    }

    if (password.length > 128) {
      return NextResponse.json(
        formatErrorResponse({ title: "Password too long", message: "Password must be 128 characters or fewer.", code: "PASSWORD_TOO_LONG" }),
        { status: 400 }
      );
    }

    // Validate password complexity
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
    if (!passwordRegex.test(password)) {
      return NextResponse.json(
        formatErrorResponse({ title: "Weak password", message: "Password must contain at least one uppercase letter, one lowercase letter, and one number.", code: "PASSWORD_WEAK" }),
        { status: 400 }
      );
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json(
        formatErrorResponse(AuthErrors.EMAIL_ALREADY_EXISTS),
        { status: 409 }
      );
    }

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        password: hashedPassword,
        ...(normalizedPhone && { phoneNumber: normalizedPhone }),
      },
      select: { id: true, email: true, name: true },
    });

    // Fire-and-forget: don't block registration response on analytics
    trackSignup(user.id, source).catch(err => console.warn("[analytics]", err));

    // Server-side conversion: Meta CAPI (fire-and-forget, bypasses ad blockers)
    trackServerSignup({
      email: normalizedEmail,
      phone: normalizedPhone,
      firstName: name?.split(" ")[0],
      ip,
      userAgent: req.headers.get("user-agent") || undefined,
    }).catch(err => console.warn("[meta-capi]", err));

    // Claim referral if a code was provided (awaited — ensures bonuses are granted)
    if (referralCode && typeof referralCode === "string") {
      const claimResult = await claimReferralCode(referralCode, user.id);
      if (!claimResult.success) {
        console.warn("[register] Referral claim failed:", claimResult.error);
      }
    }

    // Send verification email (fire-and-forget) — skip for phone-only registrations
    if (normalizedEmail.endsWith("@phone.buildflow.app")) {
      return NextResponse.json({ user }, { status: 201 });
    }
    const verifyToken = crypto.randomBytes(32).toString("hex");
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    prisma.verificationToken.create({
      data: {
        identifier: `verify:${normalizedEmail}`,
        token: verifyToken,
        expires: verifyExpires,
      },
    }).then(() => {
      const baseUrl = process.env.NEXTAUTH_URL
        || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
        || "https://trybuildflow.in";
      const verifyUrl = `${baseUrl}/verify-email?token=${verifyToken}&email=${encodeURIComponent(normalizedEmail)}`;
      sendVerificationEmail(normalizedEmail, name, verifyUrl).catch(err => console.warn("[register] Failed to send verification email:", err));
    }).catch(err => console.warn("[register] Failed to create verification token:", err));

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error("[auth/register] Error:", error);

    // Handle database unique constraint errors
    if ((error as { code?: string }).code === "P2002") {
      const target = (error as { meta?: { target?: string[] } }).meta?.target;
      if (target?.includes("phoneNumber")) {
        return NextResponse.json(
          formatErrorResponse(AuthErrors.PHONE_ALREADY_EXISTS),
          { status: 409 }
        );
      }
      return NextResponse.json(
        formatErrorResponse(AuthErrors.EMAIL_ALREADY_EXISTS),
        { status: 409 }
      );
    }

    // Handle Neon WebSocket / transient connection errors
    const isConnectionError = (
      (error as { type?: string })?.type === "error" || // ErrorEvent from Neon WS
      (error as { code?: string })?.code === "ECONNRESET" ||
      (error as { code?: string })?.code === "ECONNREFUSED" ||
      (error as { message?: string })?.message?.includes("fetch failed")
    );
    if (isConnectionError) {
      console.warn("[auth/register] Database connection error — transient, user should retry");
      return NextResponse.json(
        formatErrorResponse({
          title: "Connection hiccup",
          message: "Our database took a coffee break. Please try again in a moment.",
          action: "Try Again",
          code: "NET_001",
        }),
        { status: 503 }
      );
    }

    // Generic error
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 }
    );
  }
}
