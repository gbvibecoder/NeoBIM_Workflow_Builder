import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";
import { runStage1PromptIntelligence } from "@/features/floor-plan/lib/vip-pipeline/stage-1-prompt";
import { runStage2ParallelImageGen } from "@/features/floor-plan/lib/vip-pipeline/stage-2-images";
import { parseConstraints } from "@/features/floor-plan/lib/structured-parser";
import type { ImageGenPrompt } from "@/features/floor-plan/lib/vip-pipeline/types";

/**
 * POST /api/admin/vip-test-stage2
 *
 * Mode 1 — full pipeline: { "prompt": "3BHK 40x40 north" }
 * Mode 2 — Stage 2 only: { "imagePrompts": [...] }
 *
 * Base64 image data is truncated to 200 chars in the response.
 * Full images stay server-side only.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const body = await req.json();
  const prompt = body.prompt as string | undefined;
  const directPrompts = body.imagePrompts as ImageGenPrompt[] | undefined;

  let imagePrompts: ImageGenPrompt[];
  let stage1Ms = 0;
  let parseMs = 0;
  let mode: string;

  if (directPrompts && Array.isArray(directPrompts) && directPrompts.length > 0) {
    mode = "stage2-only";
    imagePrompts = directPrompts;
  } else if (prompt && typeof prompt === "string" && prompt.trim()) {
    mode = "end-to-end";
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 503 },
      );
    }

    try {
      const pStart = Date.now();
      const parseRes = await parseConstraints(prompt, openaiKey);
      parseMs = Date.now() - pStart;

      const s1Start = Date.now();
      const { output: s1 } = await runStage1PromptIntelligence({
        prompt,
        parsedConstraints: parseRes.constraints,
      });
      stage1Ms = Date.now() - s1Start;
      imagePrompts = s1.imagePrompts;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { success: false, mode: "end-to-end", error: `Pre-Stage2 failure: ${msg}` },
        { status: 500 },
      );
    }
  } else {
    return NextResponse.json(
      { error: "Provide 'prompt' (string) or 'imagePrompts' (array)" },
      { status: 400 },
    );
  }

  try {
    const s2Start = Date.now();
    const { output, metrics } = await runStage2ParallelImageGen({ imagePrompts });
    const stage2Ms = Date.now() - s2Start;

    return NextResponse.json({
      success: true,
      mode,
      imageCount: output.images.length,
      images: output.images.map((img) => ({
        model: img.model,
        width: img.width,
        height: img.height,
        generationTimeMs: img.generationTimeMs,
        base64Preview: img.base64 ? img.base64.slice(0, 200) + "..." : null,
      })),
      perModel: metrics.perModel,
      costs: {
        stage2Usd: metrics.totalCostUsd,
        totalUsd: metrics.totalCostUsd,
      },
      timing: {
        parseMs,
        stage1Ms,
        stage2Ms,
        totalMs: parseMs + stage1Ms + stage2Ms,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, mode, error: msg },
      { status: 500 },
    );
  }
}
