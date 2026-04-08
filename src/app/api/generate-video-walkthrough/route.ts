import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse } from "@/lib/user-errors";
import { submitDualWalkthrough } from "@/services/video-service";

/**
 * POST /api/generate-video-walkthrough
 *
 * Dedicated endpoint for the standalone /dashboard/3d-render page
 * (VideoRenderStudio.tsx). Unlike GN-009 (the workflow node) this route
 * does NOT need an executionId, tileInstanceId, or workflow context — it's
 * a simple "image in → Kling task IDs out" handler.
 *
 * Body:
 *   {
 *     sourceImage: string,    // data URL, raw base64, OR http(s) URL
 *     description?: string,   // GPT-4o floor-plan analysis
 *     rooms?: string[],       // ["Living Room", "Kitchen", "Bedroom"]
 *     buildingType?: string   // optional override for the Three.js fallback
 *   }
 *
 * Returns:
 *   { status: "processing", pipeline: "kling-dual",
 *     exteriorTaskId, interiorTaskId, submittedAt, durationSeconds }
 *  OR
 *   { status: "client-rendering", pipeline: "threejs-client", buildingConfig }
 *
 * Rate limit: 3 generations per hour per user (Kling pro = $1.50/15s).
 */
export const maxDuration = 120;

interface ThreeJsBuildingConfig {
  floors: number;
  floorHeight: number;
  footprint: number;
  buildingType: string;
}

function fallbackBuildingConfig(buildingType: string, roomCount: number): ThreeJsBuildingConfig {
  // Heuristic: more rooms → bigger footprint, residential default
  const footprint = Math.max(80, Math.min(600, 80 + roomCount * 35));
  return {
    floors: 1,
    floorHeight: 3.0,
    footprint,
    buildingType: buildingType || "modern apartment",
  };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Unauthorized",
        message: "Please sign in to generate videos.",
        code: "AUTH_001",
      }),
      { status: 401 },
    );
  }

  // Rate limit: 3 video generations per hour. Videos are expensive (Kling
  // pro is $0.10/sec → ~$1.50 per 15s walkthrough), so we keep this much
  // tighter than the 10/min on /api/generate-3d-render.
  const rl = await checkEndpointRateLimit(session.user.id, "generate-video-walkthrough", 3, "1 h");
  if (!rl.success) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Too many video requests",
        message: "You can generate up to 3 video walkthroughs per hour. Please try again later.",
        code: "RATE_001",
      }),
      { status: 429 },
    );
  }

  let body: {
    sourceImage?: unknown;
    description?: unknown;
    rooms?: unknown;
    buildingType?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      formatErrorResponse({
        title: "Invalid request",
        message: "Request body must be valid JSON.",
        code: "VAL_001",
      }),
      { status: 400 },
    );
  }

  const rawSourceImage = typeof body.sourceImage === "string" ? body.sourceImage : "";
  const description = (typeof body.description === "string" ? body.description : "").slice(0, 4000);
  const buildingType = typeof body.buildingType === "string" ? body.buildingType : "modern apartment";
  const rooms = Array.isArray(body.rooms)
    ? body.rooms.filter((r): r is string => typeof r === "string").slice(0, 20)
    : [];

  if (!rawSourceImage) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Missing image",
        message: "sourceImage is required (data URL, raw base64, or http(s) URL).",
        code: "VAL_001",
      }),
      { status: 400 },
    );
  }

  // Normalize source image: Kling accepts both URLs and raw base64. Strip
  // any "data:image/...;base64," prefix so we pass clean base64 to Kling.
  // (See gn-009.ts "Fix F" — Kling's image field accepts both formats.)
  let klingImage: string;
  if (rawSourceImage.startsWith("http://") || rawSourceImage.startsWith("https://")) {
    klingImage = rawSourceImage;
  } else if (rawSourceImage.startsWith("data:")) {
    const commaIdx = rawSourceImage.indexOf(",");
    klingImage = commaIdx >= 0 ? rawSourceImage.slice(commaIdx + 1) : rawSourceImage;
  } else {
    klingImage = rawSourceImage; // assume raw base64
  }

  // Build a richer description that primes Kling with the rooms it should show.
  const richDescription =
    rooms.length > 0
      ? `${description}\n\nKey rooms shown in the floor plan: ${rooms.join(", ")}.`
      : description || "Modern photorealistic architectural building";

  const hasKlingKeys = !!(process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY);

  // Diagnostic log so devs can see at a glance whether the env vars are
  // visible to the running Node process. Common gotcha: editing .env.local
  // without restarting `npm run dev` → keys present in file, missing in
  // process.env. This log eliminates that ambiguity.
  console.log(
    "[video-walkthrough] Kling keys present:",
    hasKlingKeys,
    "user:",
    session.user.id,
  );

  // ── No Kling keys → Three.js client-side fallback ──
  if (!hasKlingKeys) {
    return NextResponse.json({
      status: "client-rendering",
      pipeline: "threejs-client",
      buildingConfig: fallbackBuildingConfig(buildingType, rooms.length),
      reason: "kling-not-configured",
      warning:
        "Kling AI keys are not visible to the server. Add KLING_ACCESS_KEY and KLING_SECRET_KEY to .env.local and restart the dev server. Showing local Three.js render.",
    });
  }

  // ── Kling image2video path ──
  try {
    const submitted = await submitDualWalkthrough(klingImage, richDescription, "pro");
    return NextResponse.json({
      status: "processing",
      pipeline: "kling-dual",
      exteriorTaskId: submitted.exteriorTaskId,
      interiorTaskId: submitted.interiorTaskId,
      submittedAt: submitted.submittedAt,
      durationSeconds: 15,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";

    // Log the FULL error object (not just .message) so devs can see the
    // request_id, status code, and any nested API error fields. Then log
    // the stack separately so it doesn't get truncated by JSON serialization.
    console.error("[generate-video-walkthrough] Kling submit failed:", err);
    if (err instanceof Error && err.stack) {
      console.error("[generate-video-walkthrough] Stack trace:\n" + err.stack);
    }

    // Billing / quota errors → clear actionable error so user can top up.
    const lower = msg.toLowerCase();
    const isBilling = lower.includes("balance") || lower.includes("quota") || lower.includes("billing");
    if (isBilling) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Kling balance empty",
          message: "Your Kling AI account is out of credits. Top up at klingai.com or contact support.",
          code: "BILL_001",
        }),
        { status: 402 },
      );
    }

    // Other errors → graceful degrade to Three.js so the user gets *something*.
    // Include both `klingError` (raw, for the toast) and `warning` (formatted,
    // for a banner) so the client can surface the real reason.
    return NextResponse.json({
      status: "client-rendering",
      pipeline: "threejs-client",
      buildingConfig: fallbackBuildingConfig(buildingType, rooms.length),
      reason: "kling-failed",
      klingError: msg.slice(0, 300),
      warning: `Kling AI is currently unavailable. Showing local Three.js render. (${msg.slice(0, 150)})`,
    });
  }
}
