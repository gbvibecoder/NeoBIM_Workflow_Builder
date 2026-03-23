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
    const rl = await checkEndpointRateLimit(ip, "delete-account", 3, "1 h");
    if (!rl.success) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const { confirmation, password } = await req.json();

    if (confirmation !== "DELETE") {
      return NextResponse.json({ error: "Please type DELETE to confirm." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, password: true, stripeSubscriptionId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    // If user has a password (credential account), verify it
    if (user.password) {
      if (typeof password !== "string" || !password) {
        return NextResponse.json({ error: "Please enter your password to confirm." }, { status: 400 });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return NextResponse.json({ error: "Password is incorrect." }, { status: 400 });
      }
    }

    // Cancel active subscription if any
    if (user.stripeSubscriptionId) {
      try {
        const { stripe } = await import("@/lib/stripe");
        await stripe.subscriptions.cancel(user.stripeSubscriptionId);
      } catch (err) {
        console.warn("[delete-account] Failed to cancel Stripe subscription:", err);
      }
    }

    // Delete user and cascade (Prisma onDelete: Cascade handles relations)
    await prisma.user.delete({
      where: { id: session.user.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[delete-account] Error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
