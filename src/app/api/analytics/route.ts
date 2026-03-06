import { NextResponse } from "next/server";
import { getDashboardMetrics, generateDailyReport } from "@/lib/analytics";
import { auth } from "@/lib/auth";

export async function GET(req: Request) {
  const session = await auth();
  
  // Only allow admins to view analytics
  if (!session?.user?.id || (session.user as any).role !== "PLATFORM_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");

  if (format === "report") {
    const report = await generateDailyReport();
    return NextResponse.json({ report });
  }

  const metrics = await getDashboardMetrics();
  return NextResponse.json(metrics);
}
