import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { XP_ACTIONS, levelFromXp } from "@/lib/gamification";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await req.json();
    const action = body.action as string;

    if (!action || !XP_ACTIONS[action]) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const config = XP_ACTIONS[action];

    // For one-time actions, check if already awarded
    if (config.oneTime) {
      const existing = await prisma.userAchievement.findUnique({
        where: { userId_action: { userId, action } },
      });
      if (existing) {
        // Already awarded — return current state without error
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { xp: true },
        });
        const info = levelFromXp(user?.xp ?? 0);
        return NextResponse.json({
          awarded: false,
          alreadyCompleted: true,
          xp: user?.xp ?? 0,
          level: info.level,
          progress: info.progress,
          leveledUp: false,
        });
      }
    }

    // Award XP
    const prevUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { xp: true },
    });
    const prevXp = prevUser?.xp ?? 0;
    const prevLevel = levelFromXp(prevXp).level;

    const newXp = prevXp + config.xp;
    const newInfo = levelFromXp(newXp);

    // Update user XP + record achievement in a transaction
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { xp: newXp, level: newInfo.level },
      }),
      ...(config.oneTime
        ? [
            prisma.userAchievement.create({
              data: { userId, action, xpAwarded: config.xp },
            }),
          ]
        : []),
    ]);

    const leveledUp = newInfo.level > prevLevel;

    return NextResponse.json({
      awarded: true,
      xpAwarded: config.xp,
      xp: newXp,
      level: newInfo.level,
      progress: newInfo.progress,
      leveledUp,
      newLevel: leveledUp ? newInfo.level : undefined,
    });
  } catch (error) {
    console.error("XP award error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
