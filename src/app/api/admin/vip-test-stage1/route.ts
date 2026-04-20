import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";
import { runStage1PromptIntelligence } from "@/features/floor-plan/lib/vip-pipeline/stage-1-prompt";
import { parseConstraints } from "@/features/floor-plan/lib/structured-parser";
import type { ParsedConstraints } from "@/features/floor-plan/lib/structured-parser";

/**
 * POST /api/admin/vip-test-stage1
 *
 * Admin-only test harness for VIP Stage 1 (Prompt Intelligence).
 *
 * Mode 1 — end-to-end (parse + Stage 1):
 *   POST { "prompt": "3BHK 40x40 north" }
 *
 * Mode 2 — tuning (Stage 1 only, skip parser):
 *   POST { "prompt": "3BHK 40x40 north", "parsedConstraints": { ... } }
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const body = await req.json();
  const prompt = body.prompt as string;
  const preParsed = body.parsedConstraints as ParsedConstraints | undefined;

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  let parsedConstraints: ParsedConstraints;
  let parseMs = 0;
  const mode = preParsed ? "tuning" : "end-to-end";

  if (preParsed) {
    // Mode 2: use provided parsedConstraints (tuning mode — skip parser)
    parsedConstraints = preParsed;
  } else {
    // Mode 1: parse the prompt (end-to-end mode)
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured (needed for parseConstraints)" },
        { status: 503 },
      );
    }
    const parseStart = Date.now();
    const parseRes = await parseConstraints(prompt, openaiKey);
    parseMs = Date.now() - parseStart;
    parsedConstraints = parseRes.constraints;
  }

  try {
    const stage1Start = Date.now();
    const { output, metrics } = await runStage1PromptIntelligence({
      prompt,
      parsedConstraints,
    });
    const stage1Ms = Date.now() - stage1Start;

    return NextResponse.json({
      success: true,
      mode,
      output,
      cost: metrics.costUsd,
      tokens: { input: metrics.inputTokens, output: metrics.outputTokens },
      timing: { parseMs, stage1Ms, totalMs: parseMs + stage1Ms },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, mode, error: message },
      { status: 500 },
    );
  }
}
