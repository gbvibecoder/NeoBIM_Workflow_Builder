import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { trackSignup } from "@/lib/analytics";
import { 
  formatErrorResponse, 
  FormErrors, 
  AuthErrors, 
  UserErrors 
} from "@/lib/user-errors";

export async function POST(req: NextRequest) {
  try {
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
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
