import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
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
