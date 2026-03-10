import { NextRequest, NextResponse } from "next/server";
import { getImage } from "@/lib/temp-image-store";

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
  const { id } = await params;
  console.log("[temp-image] GET:", id);

  const image = await getImage(id);

  if (!image) {
    console.warn("[temp-image] GET: not found or expired:", id);
    return NextResponse.json(
      { error: "Image not found or expired" },
      { status: 404 }
    );
  }

  console.log("[temp-image] GET: serving image", id, `(${image.buffer.length} bytes, ${image.contentType})`);

  return new NextResponse(new Uint8Array(image.buffer), {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=600",
      "Content-Length": String(image.buffer.length),
    },
  });
}
