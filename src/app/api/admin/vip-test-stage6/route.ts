import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";
import { runStage6QualityGate } from "@/features/floor-plan/lib/vip-pipeline/stage-6-quality";
import { parseConstraints } from "@/features/floor-plan/lib/structured-parser";
import { runStage1PromptIntelligence } from "@/features/floor-plan/lib/vip-pipeline/stage-1-prompt";
import { runStage2ParallelImageGen } from "@/features/floor-plan/lib/vip-pipeline/stage-2-images";
import { runStage4RoomExtraction } from "@/features/floor-plan/lib/vip-pipeline/stage-4-extract";
import { runStage5Synthesis } from "@/features/floor-plan/lib/vip-pipeline/stage-5-synthesis";

/**
 * POST /api/admin/vip-test-stage6
 * Full pipeline: { "prompt": "3BHK 40x40 north" }
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const body = await req.json();
  const prompt = body.prompt as string;
  if (!prompt?.trim()) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  try {
    const totalStart = Date.now();
    const openaiKey = process.env.OPENAI_API_KEY!;
    const pRes = await parseConstraints(prompt, openaiKey);
    const { output: s1 } = await runStage1PromptIntelligence({ prompt, parsedConstraints: pRes.constraints });
    const { output: s2 } = await runStage2ParallelImageGen({ imagePrompts: s1.imagePrompts });
    const gptImg = s2.images.find((i) => i.model === "gpt-image-1.5");
    if (!gptImg?.base64) throw new Error("No GPT image");

    const { output: s4 } = await runStage4RoomExtraction({ image: gptImg, brief: s1.brief });
    const { output: s5 } = await runStage5Synthesis({
      extraction: s4.extraction,
      plotWidthFt: s1.brief.plotWidthFt,
      plotDepthFt: s1.brief.plotDepthFt,
      facing: s1.brief.facing,
      parsedConstraints: pRes.constraints,
    });

    const { output: s6, metrics } = await runStage6QualityGate({
      project: s5.project,
      brief: s1.brief,
      parsedConstraints: pRes.constraints,
    });

    return NextResponse.json({
      success: true,
      verdict: s6.verdict,
      cost: metrics.costUsd,
      timing: { totalMs: Date.now() - totalStart },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
