import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await checkEndpointRateLimit(ip, "reset-password", 5, "15 m");
    if (!rl.success) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const { token, email, password } = await req.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (typeof token !== "string" || !token || !normalizedEmail || typeof password !== "string" || !password) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    if (password.length < 8 || password.length > 128) {
      return NextResponse.json({ error: "Password must be between 8 and 128 characters." }, { status: 400 });
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
    if (!passwordRegex.test(password)) {
      return NextResponse.json({
        error: "Password must contain uppercase, lowercase, and a number.",
      }, { status: 400 });
    }

    // Atomic delete-first: consume token in a single operation to prevent race conditions
    const deleted = await prisma.verificationToken.delete({
      where: {
        identifier_token: {
          identifier: `reset:${normalizedEmail}`,
          token,
        },
      },
    }).catch(() => null);

    if (!deleted) {
      return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
    }

    if (deleted.expires < new Date()) {
      return NextResponse.json({ error: "Reset link has expired. Please request a new one." }, { status: 400 });
    }

    // Update password
    const hashedPassword = await bcrypt.hash(password, 12);
    const updated = await prisma.user.updateMany({
      where: { email: normalizedEmail },
      data: { password: hashedPassword },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Account not found." }, { status: 400 });
    }

    // Invalidate all sessions for this user
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
    if (user) {
      await prisma.session.deleteMany({ where: { userId: user.id } }).catch((err) => console.error("[reset-password] Failed to invalidate sessions", err));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[reset-password] Error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
