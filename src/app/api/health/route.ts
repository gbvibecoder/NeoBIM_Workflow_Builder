import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  // Rate limit: 30 health checks per IP per minute
  const ip = getClientIp(req);
  const rateLimit = await checkEndpointRateLimit(ip, "health", 30, "1 m");
  if (!rateLimit.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const checks = {
    status: "ok" as "ok" | "degraded",
    timestamp: new Date().toISOString(),
    database: false,
    env: {
      openai: !!process.env.OPENAI_API_KEY,
      stripe: !!process.env.STRIPE_SECRET_KEY,
      redis: !!process.env.UPSTASH_REDIS_REST_URL,
    },
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }

  const allHealthy = checks.database && checks.env.openai;
  if (!allHealthy) checks.status = "degraded";

  return NextResponse.json(checks, { status: allHealthy ? 200 : 503 });
}
