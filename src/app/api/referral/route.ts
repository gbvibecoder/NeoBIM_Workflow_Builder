import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { trackEvent } from "@/lib/analytics";
import { getReferralBonus, checkEndpointRateLimit } from "@/lib/rate-limit";
import { REFERRAL_BONUS_PER_CLAIM } from "@/lib/referral";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Rate limit: 30 requests / minute per user
    const rl = await checkEndpointRateLimit(userId, "referral-get", 30, "1 m");
    if (!rl.success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // Fetch referral records + check if user was referred, in parallel
    const [referrals, wasReferred, bonusRemaining] = await Promise.all([
      prisma.referral.findMany({ where: { referrerId: userId } }),
      prisma.referral.findFirst({
        where: { referredId: userId, status: "completed" },
        select: { id: true },
      }),
      getReferralBonus(userId),
    ]);

    // The original code is the one with status "pending" (the reusable link)
    const codeRecord = referrals.find((r) => r.status === "pending");
    // Completed claims (each has a unique claim code)
    const completed = referrals.filter((r) => r.status === "completed").length;

    // Bonuses earned: from referring others + from being referred
    const referrerBonus = completed * REFERRAL_BONUS_PER_CLAIM;
    const referredBonus = wasReferred ? REFERRAL_BONUS_PER_CLAIM : 0;
    const totalEarned = referrerBonus + referredBonus;

    return NextResponse.json({
      code: codeRecord?.code ?? null,
      stats: {
        totalReferred: completed,
        converted: completed,
        bonusEarned: totalEarned,
        bonusRemaining,
      },
    });
  } catch (error) {
    console.error("[api/referral] GET error:", error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Rate limit: 10 requests / hour per user
    const rl = await checkEndpointRateLimit(userId, "referral-post", 10, "1 h");
    if (!rl.success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // Check if user already has a referral code (pending = the reusable link)
    const existing = await prisma.referral.findFirst({
      where: { referrerId: userId, status: "pending" },
    });

    if (existing) {
      return NextResponse.json({ code: existing.code });
    }

    // Generate unique code: first 4 chars of name + 4 random alphanumeric
    const name = session.user.name ?? "user";
    const prefix = name.replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase() || "USER";
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    let referral;
    for (let attempt = 0; attempt < 5; attempt++) {
      let suffix = "";
      for (let i = 0; i < 4; i++) {
        suffix += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const code = `${prefix}${suffix}`;
      try {
        referral = await prisma.referral.create({
          data: {
            referrerId: userId,
            code,
            status: "pending",
          },
        });
        break;
      } catch (e: unknown) {
        const prismaError = e as { code?: string };
        // P2002 = unique constraint violation — retry with a new code
        if (prismaError.code === "P2002" && attempt < 4) continue;
        throw e;
      }
    }

    if (!referral) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.INTERNAL_ERROR),
        { status: 500 }
      );
    }

    trackEvent({
      userId,
      eventName: "feature_used",
      properties: { feature: "referral_code_generated", code: referral.code },
    }).catch(() => {});

    return NextResponse.json({ code: referral.code }, { status: 201 });
  } catch (error) {
    console.error("[api/referral] POST error:", error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 }
    );
  }
}
