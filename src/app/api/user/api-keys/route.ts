import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";

// GET /api/user/api-keys
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { apiKeys: true },
    });

    return NextResponse.json({ apiKeys: user?.apiKeys ?? {} });
  } catch (error) {
    console.error("[user/api-keys/GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/user/api-keys
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await checkEndpointRateLimit(session.user.id, "api-keys", 5, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });
    }

    const { apiKeys } = await req.json();

    await prisma.user.update({
      where: { id: session.user.id },
      data: { apiKeys },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[user/api-keys/PATCH]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
