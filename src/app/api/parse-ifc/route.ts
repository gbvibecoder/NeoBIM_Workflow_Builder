import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { safeErrorMessage } from "@/lib/safe-error";

export const maxDuration = 60; // Vercel: allow 60s for WASM parsing

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkEndpointRateLimit(session.user.id, "parse-ifc", 10, "1 m");
  if (!rateLimit.success) {
    return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".ifc")) {
      return NextResponse.json({ error: "File must be an IFC file" }, { status: 400 });
    }

    // Reject files over 50MB
    const MAX_IFC_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_IFC_SIZE) {
      return NextResponse.json({ error: "IFC file too large. Maximum size is 50MB." }, { status: 413 });
    }

    // Validate IFC file header
    const headerBytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const headerStr = new TextDecoder().decode(headerBytes);
    if (!headerStr.startsWith("ISO-10303-21;")) {
      return NextResponse.json(
        { error: "Invalid IFC file. Please upload a valid .ifc file (IFC2X3 or IFC4 format)." },
        { status: 400 }
      );
    }

    // ⚡ DYNAMIC IMPORT - Lazy load 23MB web-ifc library only when needed
    const { parseIFCBuffer } = await import("@/services/ifc-parser");
    
    const buffer = new Uint8Array(await file.arrayBuffer());
    const result = await parseIFCBuffer(buffer, file.name);

    return NextResponse.json({
      result,
      meta: {
        fileSize: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
        fileName: file.name,
      },
    });
  } catch (err) {
    console.error("[parse-ifc]", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
