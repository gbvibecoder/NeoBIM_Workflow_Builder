import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

/**
 * POST /api/user/verify-phone
 * Mock phone verification — marks the user's phone as verified.
 * In production this would validate an SMS OTP code first.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 5 verification attempts per 15 minutes
    const rateLimit = await checkEndpointRateLimit(session.user.id, "verify-phone", 5, "15 m");
    if (!rateLimit.success) {
      return NextResponse.json(
        formatErrorResponse({ title: "Too many attempts", message: "Please wait before trying again.", code: "RATE_001" }),
        { status: 429 },
      );
    }

    // Check that user has a phone number set
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { phoneNumber: true, phoneVerified: true },
    });

    if (!user?.phoneNumber) {
      return NextResponse.json(
        formatErrorResponse({ title: "No phone number", message: "Please add a phone number to your profile first.", code: "VAL_001" }),
        { status: 400 },
      );
    }

    if (user.phoneVerified) {
      return NextResponse.json({ success: true, alreadyVerified: true });
    }

    // Mark phone as verified
    await prisma.user.update({
      where: { id: session.user.id },
      data: { phoneVerified: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[user/verify-phone]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
