/**
 * POST /api/generate-furniture
 *
 * Batch generates AI furniture models via 3D AI Studio and uploads to R2 CDN.
 * Uses your existing 3D AI Studio plan (3daistudio.com).
 * Requires PLATFORM_ADMIN role.
 *
 * Query params:
 *   ?single=modern-sofa.glb — Generate a single specific model
 *   ?dryRun=true — Check which models need generating + cost estimate
 *   ?edition=rapid|pro — Model quality (default: rapid = 35 credits)
 *
 * Body (optional):
 *   { concurrency: 2, enablePbr: true } — Parallel count + PBR toggle
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  generateAllFurniture,
  generateSingleFurniture,
  isFurnitureGenerationAvailable,
} from "@/services/furniture-generator";
import { getAllAIPrompts } from "@/services/furniture-catalog";

export async function POST(request: Request) {
  // Auth: require PLATFORM_ADMIN
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prisma } = await import("@/lib/db");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (user?.role !== "PLATFORM_ADMIN") {
    return NextResponse.json(
      { error: "Forbidden — PLATFORM_ADMIN role required" },
      { status: 403 }
    );
  }

  // Check 3D AI Studio configuration
  if (!isFurnitureGenerationAvailable()) {
    return NextResponse.json(
      {
        error: "THREE_D_AI_STUDIO_API_KEY not configured",
        help: "Get your API key from https://www.3daistudio.com/Platform/API and add THREE_D_AI_STUDIO_API_KEY to .env.local",
      },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const singleFile = url.searchParams.get("single");
  const dryRun = url.searchParams.get("dryRun") === "true";
  const edition = (url.searchParams.get("edition") || "rapid") as "rapid" | "pro";

  // Dry run — list what needs generating + cost estimate
  if (dryRun) {
    const prompts = getAllAIPrompts();
    const creditsPerItem = edition === "pro" ? 80 : 55; // base + PBR
    return NextResponse.json({
      total: prompts.length,
      edition,
      creditsPerModel: creditsPerItem,
      totalCreditsNeeded: prompts.length * creditsPerItem,
      models: prompts.map((p) => ({
        file: p.file,
        prompt: p.prompt,
        credits: creditsPerItem,
      })),
      note: edition === "rapid"
        ? `Rapid + PBR = 55 credits each. Studio plan ($29/mo) gives 3,200 credits → enough for ~58 models.`
        : `Pro + PBR = 80 credits each. Studio plan ($29/mo) gives 3,200 credits → enough for ~40 models.`,
    });
  }

  // Single model generation
  if (singleFile) {
    const prompts = getAllAIPrompts();
    const match = prompts.find((p) => p.file === singleFile);
    if (!match) {
      return NextResponse.json(
        { error: `Model "${singleFile}" not found in catalog`, available: prompts.map((p) => p.file) },
        { status: 404 }
      );
    }

    try {
      const result = await generateSingleFurniture(match.file, match.prompt, edition);
      return NextResponse.json({
        file: match.file,
        r2Url: result.r2Url,
        durationMs: result.durationMs,
        creditsUsed: result.creditsUsed,
        edition,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  // Batch generation
  let concurrency = 2;
  let enablePbr = true;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.concurrency === "number") concurrency = Math.min(body.concurrency, 5);
    if (typeof body.enablePbr === "boolean") enablePbr = body.enablePbr;
  } catch {
    // Use defaults
  }

  try {
    const result = await generateAllFurniture(edition, concurrency, enablePbr);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  // GET returns catalog status + setup instructions
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prompts = getAllAIPrompts();
  const configured = isFurnitureGenerationAvailable();

  return NextResponse.json({
    provider: "3D AI Studio (3daistudio.com)",
    configured,
    apiKeyEnvVar: "THREE_D_AI_STUDIO_API_KEY",
    total: prompts.length,
    models: prompts.map((p) => ({
      file: p.file,
      targetH: p.targetH,
    })),
    ...(configured
      ? {}
      : {
          setup: {
            step1: "Go to https://www.3daistudio.com/Platform/API",
            step2: "Copy your API key",
            step3: "Add to .env.local: THREE_D_AI_STUDIO_API_KEY=your_key_here",
            step4: "POST /api/generate-furniture?dryRun=true to see cost estimate",
            step5: "POST /api/generate-furniture to batch generate all models",
          },
        }),
  });
}
