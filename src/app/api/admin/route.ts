import { NextResponse } from "next/server";
import { validateAdminCredentials, getAdminSessionCookie } from "@/lib/admin-auth";
import { getAdminSession, unauthorizedResponse, logAudit } from "@/lib/admin-server";
import { checkEndpointRateLimit } from "@/lib/rate-limit";

/** GET /api/admin — return current admin session info */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return unauthorizedResponse();
  return NextResponse.json({ admin: session });
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await checkEndpointRateLimit(ip, "admin-login", 5, "15 m");
    if (!rl.success) {
      return NextResponse.json({ error: "Too many login attempts. Please wait." }, { status: 429 });
    }

    const { username, password } = await req.json();

    const admin = await validateAdminCredentials(username, password);
    if (!admin) {
      await logAudit(null, "ADMIN_LOGIN", "admin", null, {
        username,
        success: false,
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    await logAudit(admin.id, "ADMIN_LOGIN", "admin", admin.id, {
      username: admin.username,
      success: true,
    });

    const response = NextResponse.json({
      success: true,
      admin: { id: admin.id, displayName: admin.displayName, role: admin.role },
    });
    response.headers.set("Set-Cookie", getAdminSessionCookie(admin.sessionCookie));
    return response;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
