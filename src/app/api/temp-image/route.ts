import { NextRequest, NextResponse } from "next/server";
import { storeImage, getTempImageUrl } from "@/lib/temp-image-store";

/**
 * POST /api/temp-image
 * Accepts { base64, contentType } and stores the image in Upstash Redis.
 * Returns { url } — a publicly accessible URL that serves the image.
 * Images auto-expire after 10 minutes (Redis TTL).
 */
export async function POST(req: NextRequest) {
  try {
    const { base64, contentType } = await req.json();

    if (!base64 || typeof base64 !== "string") {
      return NextResponse.json({ error: "base64 is required" }, { status: 400 });
    }

    const mime = typeof contentType === "string" ? contentType : "image/jpeg";
    const id = await storeImage(base64, mime);
    const url = getTempImageUrl(id);

    console.log("[temp-image] POST: stored image", id, "→", url);
    return NextResponse.json({ url, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[temp-image] POST error:", msg);
    return NextResponse.json(
      { error: `Failed to store image: ${msg}` },
      { status: 500 }
    );
  }
}
