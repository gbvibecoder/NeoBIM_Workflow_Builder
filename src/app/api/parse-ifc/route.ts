import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const maxDuration = 60; // Vercel: allow 60s for WASM parsing

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // ⚡ DYNAMIC IMPORT - Lazy load 23MB web-ifc library only when needed
    const { parseIFCBuffer } = await import("@/services/ifc-parser");
    
    const buffer = new Uint8Array(await file.arrayBuffer());
    const result = await parseIFCBuffer(buffer, file.name);

    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "IFC parsing failed";
    console.error("[parse-ifc]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
