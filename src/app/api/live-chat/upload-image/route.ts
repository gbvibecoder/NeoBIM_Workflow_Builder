import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";

const MAX_BASE64_SIZE = 2 * 1024 * 1024; // ~2MB base64 ≈ ~1.5MB image

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rl = await checkEndpointRateLimit(session.user.id, "live-chat-image", 5, "1 m");
  if (!rl.success) {
    return NextResponse.json(
      { error: { title: "Slow down", message: "Too many image uploads.", code: "RATE_001" } },
      { status: 429 },
    );
  }

  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: { title: "Unavailable", message: "Image uploads are not configured.", code: "SYS_001" } },
      { status: 503 },
    );
  }

  try {
    const body = await req.json();
    const base64 = body.image as string | undefined;
    if (!base64 || typeof base64 !== "string") {
      return NextResponse.json(
        { error: { title: "Invalid", message: "Image data is required.", code: "VAL_001" } },
        { status: 400 },
      );
    }

    // Strip data URL prefix if present
    const raw = base64.replace(/^data:image\/\w+;base64,/, "");
    if (raw.length > MAX_BASE64_SIZE) {
      return NextResponse.json(
        { error: { title: "Too large", message: "Image must be under 1.5MB.", code: "VAL_001" } },
        { status: 400 },
      );
    }

    // Upload to imgbb (no expiration — permanent for chat history)
    const formData = new URLSearchParams();
    formData.append("key", apiKey);
    formData.append("image", raw);

    const res = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    if (!data.success) {
      console.error("[live-chat/upload-image] imgbb failed:", data.error);
      return NextResponse.json(
        { error: { title: "Upload failed", message: "Could not upload image. Please try again.", code: "NET_001" } },
        { status: 502 },
      );
    }

    return NextResponse.json({ url: data.data.url });
  } catch (e) {
    console.error("[live-chat/upload-image] error:", e);
    return NextResponse.json(
      { error: { title: "Server error", message: "Something went wrong.", code: "NET_001" } },
      { status: 500 },
    );
  }
}
