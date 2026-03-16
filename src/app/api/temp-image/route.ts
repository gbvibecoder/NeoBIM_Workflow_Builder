import { NextRequest, NextResponse } from "next/server";
import { storeImage, getTempImageUrl } from "@/lib/temp-image-store";
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

/**
 * OPTIONS /api/temp-image
 * CORS preflight handler.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/temp-image
 * Accepts { base64, contentType } and stores the image in Upstash Redis.
 * Returns { url } — a publicly accessible URL that serves the image.
 * Images auto-expire after 10 minutes (Redis TTL).
 */
export async function POST(req: NextRequest) {
  try {
    // Rate limit: 30 uploads per IP per minute
    const ip = getClientIp(req);
    const rateLimit = await checkEndpointRateLimit(ip, "temp-image-upload", 30, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: CORS_HEADERS });
    }

    const { base64, contentType } = await req.json();

    if (!base64 || typeof base64 !== "string") {
      return NextResponse.json({ error: "base64 is required" }, { status: 400, headers: CORS_HEADERS });
    }

    const mime = typeof contentType === "string" ? contentType : "image/jpeg";
    const id = await storeImage(base64, mime);
    const url = getTempImageUrl(id);

    console.log("[temp-image] POST: stored image", id, "→", url);
    return NextResponse.json({ url, id }, { headers: CORS_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[temp-image] POST error:", msg);
    return NextResponse.json(
      { error: `Failed to store image: ${msg}` },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
