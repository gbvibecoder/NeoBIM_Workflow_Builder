import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await checkEndpointRateLimit(ip, "change-password", 5, "15 m");
    if (!rl.success) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const { currentPassword, newPassword } = await req.json();

    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      return NextResponse.json({ error: "Invalid input." }, { status: 400 });
    }

    if (newPassword.length < 8 || newPassword.length > 128) {
      return NextResponse.json({ error: "New password must be between 8 and 128 characters." }, { status: 400 });
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
    if (!passwordRegex.test(newPassword)) {
      return NextResponse.json({
        error: "Password must contain uppercase, lowercase, and a number.",
      }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { password: true },
    });

    if (!user?.password) {
      return NextResponse.json({
        error: "Your account uses Google sign-in. Password change is not available.",
      }, { status: 400 });
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: session.user.id },
      data: { password: hashedPassword },
    });

    // Invalidate all other sessions so compromised sessions are kicked out
    await prisma.session.deleteMany({
      where: { userId: session.user.id },
    }).catch((err) => console.error("[change-password] Failed to invalidate other sessions:", err));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[change-password] Error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
