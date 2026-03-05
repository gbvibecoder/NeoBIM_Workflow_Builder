import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDashboardMetrics } from "@/lib/analytics";

export async function GET() {
  const session = await auth();
  
  // Only allow admins to view analytics
  if (!session?.user?.id || !(session.user as any).role === "PLATFORM_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const metrics = await getDashboardMetrics();
  
  return NextResponse.json(metrics);
}
