import { NextRequest, NextResponse } from "next/server";
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Proxy endpoint for GLB files from external sources that lack CORS headers.
 * Used by GN-001 when R2 upload isn't available — proxies the GLB through
 * our own domain so the browser's Three.js GLTFLoader can fetch it.
 *
 * GET /api/proxy-glb?url=https://...signed-url...
 */

const MAX_GLB_SIZE = 100 * 1024 * 1024; // 100 MB max
const FETCH_TIMEOUT_MS = 30_000; // 30 seconds

/** Strict domain check — prevents SSRF via subdomain spoofing */
function isAllowedDomain(hostname: string): boolean {
  const allowed = [
    "r2.cloudflarestorage.com",
    "3daistudio.com",
    "api.3daistudio.com",
  ];
  return allowed.some(
    domain => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

export async function GET(req: NextRequest) {
  // Rate limit: 20 proxy requests per IP per minute
  const ip = getClientIp(req);
  const rateLimit = await checkEndpointRateLimit(ip, "proxy-glb", 20, "1 m");
  if (!rateLimit.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Validate URL structure and domain
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Enforce HTTPS only — prevents protocol downgrade attacks
  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Only HTTPS URLs are allowed" }, { status: 403 });
  }

  if (!isAllowedDomain(parsed.hostname)) {
    return NextResponse.json({ error: "URL not from allowed domain" }, { status: 403 });
  }

  try {
    // Fetch with timeout and no automatic redirect following
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        redirect: "error", // reject redirects — prevents SSRF via redirect chains
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream fetch failed: ${res.status}` },
        { status: res.status }
      );
    }

    // Check Content-Length before downloading to prevent OOM
    const contentLength = Number(res.headers.get("content-length") ?? 0);
    if (contentLength > MAX_GLB_SIZE) {
      return NextResponse.json(
        { error: `File too large: ${(contentLength / 1024 / 1024).toFixed(0)} MB exceeds ${MAX_GLB_SIZE / 1024 / 1024} MB limit` },
        { status: 413 }
      );
    }

    const buffer = await res.arrayBuffer();

    // Double-check actual size (Content-Length can lie)
    if (buffer.byteLength > MAX_GLB_SIZE) {
      return NextResponse.json(
        { error: "File too large" },
        { status: 413 }
      );
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "model/gltf-binary",
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return NextResponse.json({ error: "Upstream fetch timed out" }, { status: 504 });
    }
    console.error("[proxy-glb] Fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch GLB" },
      { status: 502 }
    );
  }
}
