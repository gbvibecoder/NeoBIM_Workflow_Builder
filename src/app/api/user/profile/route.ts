import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors, FormErrors, AuthErrors } from "@/lib/user-errors";
import { normalizePhone } from "@/lib/form-validation";
import { sendVerificationEmail } from "@/services/email";

const MAX_IMAGE_BASE64_SIZE = 100 * 1024; // 100KB base64 string (~75KB image)
const MAX_NAME_LENGTH = 100;
const PLACEHOLDER_EMAIL_DOMAIN = "@phone.buildflow.app";
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

// GET /api/user/profile
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, image: true, password: true, emailVerified: true, phoneNumber: true, phoneVerified: true, createdAt: true, role: true },
    });

    const isPlaceholderEmail = user?.email?.endsWith(PLACEHOLDER_EMAIL_DOMAIN) ?? false;

    const response = NextResponse.json({
      name: user?.name ?? null,
      email: isPlaceholderEmail ? null : (user?.email ?? null),
      image: user?.image ?? null,
      isOAuthOnly: !user?.password,
      emailVerified: isPlaceholderEmail ? false : !!user?.emailVerified,
      phoneNumber: user?.phoneNumber ?? null,
      phoneVerified: !!user?.phoneVerified,
      createdAt: user?.createdAt?.toISOString() ?? null,
      role: user?.role ?? "FREE",
      hasPlaceholderEmail: isPlaceholderEmail,
    });
    response.headers.set("Cache-Control", "private, max-age=30");
    return response;
  } catch (error) {
    console.error("[user/profile/GET]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}

// PATCH /api/user/profile
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const rateLimit = await checkEndpointRateLimit(session.user.id, "user-profile", 10, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json(
        formatErrorResponse({ title: "Too many requests", message: "Too many profile updates. Please wait a moment.", code: "RATE_001" }),
        { status: 429 },
      );
    }

    const body = await req.json();
    const { name, image, phoneNumber: rawPhone, email: rawEmail } = body as { name?: string | null; image?: string | null; phoneNumber?: string | null; email?: string | null };

    const updateData: { name?: string | null; image?: string | null; phoneNumber?: string | null; phoneVerified?: null; email?: string; emailVerified?: null } = {};

    // Validate name if provided
    if ("name" in body) {
      if (name !== null && typeof name !== "string") {
        return NextResponse.json(
          formatErrorResponse({ title: "Invalid name", message: "Name must be a string.", code: "VAL_001" }),
          { status: 400 },
        );
      }
      if (name && name.trim().length > MAX_NAME_LENGTH) {
        return NextResponse.json(
          formatErrorResponse({ title: "Name too long", message: `Name must be ${MAX_NAME_LENGTH} characters or less.`, code: "VAL_001" }),
          { status: 400 },
        );
      }
      updateData.name = name ? name.trim() : null;
    }

    // Validate image if provided
    if ("image" in body) {
      if (image === null) {
        updateData.image = null;
      } else if (typeof image === "string") {
        if (!image.startsWith("data:image/")) {
          return NextResponse.json(
            formatErrorResponse({ title: "Invalid image", message: "Image must be a valid data URL.", code: "VAL_001" }),
            { status: 400 },
          );
        }
        if (image.length > MAX_IMAGE_BASE64_SIZE) {
          return NextResponse.json(
            formatErrorResponse({ title: "Image too large", message: "Profile image must be under 100KB. Try a smaller image.", code: "VAL_001" }),
            { status: 413 },
          );
        }
        updateData.image = image;
      } else {
        return NextResponse.json(
          formatErrorResponse({ title: "Invalid image", message: "Image must be a string or null.", code: "VAL_001" }),
          { status: 400 },
        );
      }
    }

    // Validate and update email if provided
    if ("email" in body && typeof rawEmail === "string" && rawEmail.trim()) {
      const normalizedEmail = rawEmail.trim().toLowerCase();

      // Validate format
      if (!EMAIL_REGEX.test(normalizedEmail)) {
        return NextResponse.json(
          formatErrorResponse(FormErrors.INVALID_EMAIL),
          { status: 400 },
        );
      }

      // Block placeholder emails
      if (normalizedEmail.endsWith(PLACEHOLDER_EMAIL_DOMAIN)) {
        return NextResponse.json(
          formatErrorResponse({ title: "Invalid email", message: "Please enter a real email address.", code: "VAL_001" }),
          { status: 400 },
        );
      }

      // Check uniqueness
      const existingEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingEmail && existingEmail.id !== session.user.id) {
        return NextResponse.json(
          formatErrorResponse(AuthErrors.EMAIL_ALREADY_EXISTS),
          { status: 409 },
        );
      }

      // Only update if actually changed
      const currentUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { email: true },
      });
      if (currentUser?.email !== normalizedEmail) {
        updateData.email = normalizedEmail;
        updateData.emailVerified = null; // Reset verification for new email
      }
    }

    // Validate phone number if provided
    if ("phoneNumber" in body) {
      if (rawPhone === null || rawPhone === "") {
        // Allow removing phone number
        updateData.phoneNumber = null;
        updateData.phoneVerified = null;
      } else if (typeof rawPhone === "string") {
        const normalized = normalizePhone(rawPhone);
        if (!normalized) {
          return NextResponse.json(
            formatErrorResponse(FormErrors.INVALID_PHONE),
            { status: 400 },
          );
        }

        // Check if this phone is already taken by another user
        const existing = await prisma.user.findUnique({ where: { phoneNumber: normalized } });
        if (existing && existing.id !== session.user.id) {
          return NextResponse.json(
            formatErrorResponse(AuthErrors.PHONE_ALREADY_EXISTS),
            { status: 409 },
          );
        }

        // Only update if actually changed — preserve phoneVerified if phone didn't change
        const currentUser = await prisma.user.findUnique({
          where: { id: session.user.id },
          select: { phoneNumber: true },
        });
        if (currentUser?.phoneNumber !== normalized) {
          updateData.phoneNumber = normalized;
          // Reset verification when phone number changes
          updateData.phoneVerified = null;
        }
      } else {
        return NextResponse.json(
          formatErrorResponse({ title: "Invalid phone", message: "Phone number must be a string or null.", code: "VAL_001" }),
          { status: 400 },
        );
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        formatErrorResponse({ title: "No changes", message: "No fields to update.", code: "VAL_001" }),
        { status: 400 },
      );
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
      select: { name: true, email: true },
    });

    // If email was changed, send verification email (fire-and-forget)
    if (updateData.email) {
      const verifyToken = crypto.randomBytes(32).toString("hex");
      const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Delete any existing verification tokens for this email
      prisma.verificationToken.deleteMany({
        where: { identifier: `verify:${updateData.email}` },
      }).then(() =>
        prisma.verificationToken.create({
          data: {
            identifier: `verify:${updateData.email}`,
            token: verifyToken,
            expires: verifyExpires,
          },
        })
      ).then(() => {
        const baseUrl = process.env.NEXTAUTH_URL
          || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
          || "https://trybuildflow.in";
        const verifyUrl = `${baseUrl}/verify-email?token=${verifyToken}&email=${encodeURIComponent(updateData.email!)}`;
        sendVerificationEmail(updateData.email!, updatedUser.name, verifyUrl).catch(err =>
          console.warn("[profile] Failed to send verification email:", err)
        );
      }).catch(err => console.warn("[profile] Failed to create verification token:", err));
    }

    return NextResponse.json({ success: true, emailChanged: !!updateData.email });
  } catch (error) {
    console.error("[user/profile/PATCH]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
