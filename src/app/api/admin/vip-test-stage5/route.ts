import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";
import { runStage1PromptIntelligence } from "@/features/floor-plan/lib/vip-pipeline/stage-1-prompt";
import { runStage2ParallelImageGen } from "@/features/floor-plan/lib/vip-pipeline/stage-2-images";
import { runStage3ExtractionJury } from "@/features/floor-plan/lib/vip-pipeline/stage-3-jury";
import { runStage4RoomExtraction } from "@/features/floor-plan/lib/vip-pipeline/stage-4-extract";
import { runStage5Synthesis } from "@/features/floor-plan/lib/vip-pipeline/stage-5-synthesis";
import { parseConstraints } from "@/features/floor-plan/lib/structured-parser";

/**
 * POST /api/admin/vip-test-stage5
 *
 * Full pipeline: { "prompt": "3BHK 40x40 north" }
 * Returns the FloorPlanProject JSON.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const body = await req.json();
  const prompt = body.prompt as string;
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 503 },
    );
  }

  try {
    const totalStart = Date.now();

    const parseRes = await parseConstraints(prompt, openaiKey);
    const { output: s1 } = await runStage1PromptIntelligence({
      prompt,
      parsedConstraints: parseRes.constraints,
    });
    const { output: s2 } = await runStage2ParallelImageGen({
      imagePrompts: s1.imagePrompts,
    });

    const gptImage = s2.images.find((i) => i.model === "gpt-image-1.5");
    if (!gptImage?.base64) {
      return NextResponse.json(
        { success: false, error: "GPT image not generated" },
        { status: 500 },
      );
    }

    await runStage3ExtractionJury({ gptImage, brief: s1.brief });

    const { output: s4 } = await runStage4RoomExtraction({
      image: gptImage,
      brief: s1.brief,
    });

    const { output: s5, metrics } = await runStage5Synthesis({
      extraction: s4.extraction,
      plotWidthFt: s1.brief.plotWidthFt,
      plotDepthFt: s1.brief.plotDepthFt,
      facing: s1.brief.facing,
      parsedConstraints: parseRes.constraints,
    });

    const totalMs = Date.now() - totalStart;
    const floor = s5.project.floors[0];

    return NextResponse.json({
      success: true,
      summary: {
        rooms: floor?.rooms.length ?? 0,
        walls: floor?.walls.length ?? 0,
        doors: floor?.doors.length ?? 0,
        windows: floor?.windows.length ?? 0,
        issues: s5.issues.length,
      },
      metrics,
      timing: { totalMs },
      issues: s5.issues,
      project: s5.project,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 },
    );
  }
}
