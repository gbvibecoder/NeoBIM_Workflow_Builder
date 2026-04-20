import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";
import { runStage1PromptIntelligence } from "@/features/floor-plan/lib/vip-pipeline/stage-1-prompt";
import { runStage2ParallelImageGen } from "@/features/floor-plan/lib/vip-pipeline/stage-2-images";
import { runStage3ExtractionJury } from "@/features/floor-plan/lib/vip-pipeline/stage-3-jury";
import { runStage4RoomExtraction } from "@/features/floor-plan/lib/vip-pipeline/stage-4-extract";
import { parseConstraints } from "@/features/floor-plan/lib/structured-parser";
import type {
  GeneratedImage,
  ArchitectBrief,
} from "@/features/floor-plan/lib/vip-pipeline/types";

/**
 * POST /api/admin/vip-test-stage4
 *
 * Mode 1 — full pipeline: { "prompt": "3BHK 40x40 north" }
 * Mode 2 — Stage 4 only: { "gptImageBase64": "...", "brief": {...} }
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const body = await req.json();
  const prompt = body.prompt as string | undefined;
  const directImage = body.gptImageBase64 as string | undefined;
  const directBrief = body.brief as ArchitectBrief | undefined;

  let gptImage: GeneratedImage;
  let brief: ArchitectBrief;
  let preStageMs = 0;
  let mode: string;

  if (directImage && directBrief) {
    mode = "stage4-only";
    gptImage = {
      model: "gpt-image-1.5",
      base64: directImage,
      width: 1024,
      height: 1024,
      generationTimeMs: 0,
    };
    brief = directBrief;
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
      const start = Date.now();
      const parseRes = await parseConstraints(prompt, openaiKey);
      const { output: s1 } = await runStage1PromptIntelligence({
        prompt,
        parsedConstraints: parseRes.constraints,
      });
      const { output: s2 } = await runStage2ParallelImageGen({
        imagePrompts: s1.imagePrompts,
      });

      const found = s2.images.find((i) => i.model === "gpt-image-1.5");
      if (!found?.base64) {
        return NextResponse.json(
          {
            success: false,
            mode,
            error: "GPT image not generated in Stage 2",
          },
          { status: 500 },
        );
      }

      // Optional: run Stage 3 jury to check quality first
      const { output: s3 } = await runStage3ExtractionJury({
        gptImage: found,
        brief: s1.brief,
      });

      preStageMs = Date.now() - start;
      gptImage = found;
      brief = s1.brief;

      // Include jury verdict in response for context
      (body as Record<string, unknown>)._juryVerdict = s3.verdict;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { success: false, mode: "end-to-end", error: `Pre-Stage4: ${msg}` },
        { status: 500 },
      );
    }
  } else {
    return NextResponse.json(
      {
        error:
          "Provide 'prompt' (string) or both 'gptImageBase64' + 'brief'",
      },
      { status: 400 },
    );
  }

  try {
    const s4Start = Date.now();
    const { output, metrics } = await runStage4RoomExtraction({
      image: gptImage,
      brief,
    });
    const stage4Ms = Date.now() - s4Start;

    return NextResponse.json({
      success: true,
      mode,
      extraction: output.extraction,
      cost: metrics.costUsd,
      tokens: { input: metrics.inputTokens, output: metrics.outputTokens },
      timing: { preStageMs, stage4Ms, totalMs: preStageMs + stage4Ms },
      juryVerdict: (body as Record<string, unknown>)._juryVerdict ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, mode, error: msg },
      { status: 500 },
    );
  }
}
