import { NextRequest, NextResponse } from "next/server";
import { getImage } from "@/lib/temp-image-store";
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

/**
 * OPTIONS /api/temp-image/[id]
 * CORS preflight handler so external services (e.g. Kling API) can fetch images.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/temp-image/[id]
 * Retrieves a temporary image from Upstash Redis and serves it
 * with the correct Content-Type header.
 * Returns 404 if the image has expired or was never stored.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit: 60 reads per IP per minute
  const ip = getClientIp(_req);
  const rateLimit = await checkEndpointRateLimit(ip, "temp-image-read", 60, "1 m");
  if (!rateLimit.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: CORS_HEADERS });
  }

  const { id } = await params;

  const image = await getImage(id);

  if (!image) {
    console.warn("[temp-image] GET: not found or expired:", id);
    return NextResponse.json(
      { error: "Image not found or expired" },
      { status: 404, headers: CORS_HEADERS }
    );
  }


  return new NextResponse(new Uint8Array(image.buffer), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=600",
      "Content-Length": String(image.buffer.length),
    },
  });
}
