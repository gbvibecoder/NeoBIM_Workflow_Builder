import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { trackSignup } from "@/lib/analytics";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import {
  formatErrorResponse,
  FormErrors,
  AuthErrors,
  UserErrors
} from "@/lib/user-errors";

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

    const { name, email, password, source } = await req.json();

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
      data: { name, email: normalizedEmail, password: hashedPassword },
      select: { id: true, email: true, name: true },
    });

    // Fire-and-forget: don't block registration response on analytics
    trackSignup(user.id, source).catch(() => {});

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error("[auth/register] Error:", error);
    
    // Handle database errors
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        formatErrorResponse(AuthErrors.EMAIL_ALREADY_EXISTS),
        { status: 409 }
      );
    }
    
    // Generic error
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 }
    );
  }
}
