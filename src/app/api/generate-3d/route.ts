import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { convertImageTo3D, getConcurrencyInfo } from "@/features/3d-render/services/sam3d-service";
import { generateId } from "@/lib/utils";
import type { ExecutionArtifact } from "@/types/execution";
import { checkRateLimit, logRateLimitHit } from "@/lib/rate-limit";
import { APIError, UserErrors, formatErrorResponse } from "@/lib/user-errors";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse(UserErrors.UNAUTHORIZED),
      { status: 401 }
    );
  }

  const userId: string = session.user.id;
  const userRole = (session.user as { role?: string }).role as "FREE" | "MINI" | "STARTER" | "PRO" | "TEAM_ADMIN" | "PLATFORM_ADMIN" || "FREE";

  // Rate limiting
  try {
    const userEmail = session.user.email || "";
    const rateLimitResult = await checkRateLimit(userId, userRole, userEmail);

    if (!rateLimitResult.success) {
      const resetDate = new Date(rateLimitResult.reset);
      const daysUntilReset = Math.ceil((resetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      logRateLimitHit(userId, userRole, rateLimitResult.remaining);

      const rateLimitError = userRole === "FREE"
        ? UserErrors.RATE_LIMIT_FREE(daysUntilReset)
        : userRole === "MINI"
        ? UserErrors.RATE_LIMIT_MINI(daysUntilReset)
        : userRole === "STARTER"
        ? UserErrors.RATE_LIMIT_STARTER(daysUntilReset)
        : UserErrors.RATE_LIMIT_PRO(daysUntilReset);

      return NextResponse.json(
        formatErrorResponse(rateLimitError),
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": rateLimitResult.limit.toString(),
            "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
            "X-RateLimit-Reset": rateLimitResult.reset.toString(),
          },
        }
      );
    }
  } catch (error) {
    console.error("[generate-3d] Rate limit check failed:", error);
    return NextResponse.json(
      formatErrorResponse({ title: "Service unavailable", message: "Rate limit service temporarily unavailable. Please try again in a moment.", code: "RATE_LIMIT_UNAVAILABLE" }),
      { status: 503 }
    );
  }

  // Check FAL_KEY
  if (!process.env.FAL_KEY) {
    return NextResponse.json(
      formatErrorResponse({ title: "API key required", message: "FAL_KEY is not configured. Add your fal.ai API key in environment variables.", code: "SAM3D_001" }),
      { status: 400 }
    );
  }

  // Check concurrency
  const concurrency = getConcurrencyInfo();
  if (concurrency.available <= 0) {
    return NextResponse.json(
      formatErrorResponse({ title: "Service busy", message: "Maximum concurrent 3D generation requests reached. Please wait a moment and try again.", code: "SAM3D_002" }),
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const { imageUrl, imageBase64, seed, textPrompt, executionId, tileInstanceId } = body;

    // Validate: must have imageUrl or imageBase64
    if (!imageUrl && !imageBase64) {
      return NextResponse.json(
        formatErrorResponse({ title: "Missing image", message: "Provide an image URL or base64-encoded image.", code: "SAM3D_003" }),
        { status: 400 }
      );
    }

    // If base64, validate size
    if (imageBase64) {
      const sizeBytes = Math.ceil((imageBase64.length * 3) / 4);
      if (sizeBytes > MAX_IMAGE_SIZE_BYTES) {
        return NextResponse.json(
          formatErrorResponse({ title: "Image too large", message: "Image must be under 10MB.", code: "SAM3D_004" }),
          { status: 400 }
        );
      }
    }

    // Resolve image URL — if base64, we need to create a data URI for fal.ai
    let resolvedImageUrl = imageUrl;
    if (!resolvedImageUrl && imageBase64) {
      // fal.ai accepts data URIs
      const prefix = imageBase64.startsWith("data:") ? "" : "data:image/png;base64,";
      resolvedImageUrl = `${prefix}${imageBase64}`;
    }

    // Call SAM 3D
    const job = await convertImageTo3D(resolvedImageUrl, { seed, textPrompt });

    // Build execution artifact
    const artifact: ExecutionArtifact = {
      id: generateId(),
      executionId: executionId ?? "local",
      tileInstanceId: tileInstanceId ?? "standalone",
      type: "3d",
      data: {
        glbUrl: job.glbModel?.downloadUrl,
        plyUrl: job.plyModel?.downloadUrl,
        seed: job.glbModel?.seed,
        label: "3D Model (SAM 3D)",
        metadata: {
          glbFileSize: job.glbModel?.fileSize,
          plyFileSize: job.plyModel?.fileSize,
          expiresAt: job.glbModel?.expiresAt,
          costUsd: job.glbModel?.costUsd,
        },
      },
      metadata: {
        engine: "fal-ai/sam-3",
        real: true,
        jobId: job.id,
        generatedAt: job.completedAt,
      },
      createdAt: new Date(),
    };

    return NextResponse.json({ artifact, job: { id: job.id, status: job.status } });
  } catch (error: unknown) {
    console.error("[generate-3d] Error:", error);

    if (error instanceof APIError) {
      return NextResponse.json(
        formatErrorResponse(error.userError),
        { status: error.statusCode }
      );
    }

    const err = error as Record<string, unknown> | null;
    const message = typeof err?.message === "string" ? err.message : "3D generation failed";

    return NextResponse.json(
      formatErrorResponse({ title: "3D generation failed", message, code: "SAM3D_005" }),
      { status: 500 }
    );
  }
}
