import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { safeErrorMessage } from "@/lib/safe-error";
import { executePlan } from "@/features/ifc/services/ifc-enhancer";
import { planEnhancement } from "@/features/ifc/services/ifc-planner";

export const maxDuration = 60;

const MAX_IFC_SIZE = 25 * 1024 * 1024;
const MAX_PROMPT = 2000;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
  }

  const rl = await checkEndpointRateLimit(session.user.id, "enhance-ifc", 15, "1 m");
  if (!rl.success) {
    return NextResponse.json(
      formatErrorResponse({ title: "Too many requests", message: "Too many enhancement requests. Please wait a moment.", code: "RATE_001" }),
      { status: 429 },
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const promptRaw = formData.get("prompt");
    const prompt = typeof promptRaw === "string" ? promptRaw.trim() : "";

    if (!file) {
      return NextResponse.json(formatErrorResponse(UserErrors.MISSING_REQUIRED_FIELD("file")), { status: 400 });
    }
    if (!prompt) {
      return NextResponse.json(formatErrorResponse(UserErrors.MISSING_REQUIRED_FIELD("prompt")), { status: 400 });
    }
    if (prompt.length > MAX_PROMPT) {
      return NextResponse.json(
        formatErrorResponse({ title: "Prompt too long", message: `Prompt must be under ${MAX_PROMPT} characters.`, code: "VAL_001" }),
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        formatErrorResponse({ title: "Empty file", message: "The uploaded IFC file is empty.", code: "VAL_001" }),
        { status: 400 },
      );
    }
    if (file.size > MAX_IFC_SIZE) {
      return NextResponse.json(
        formatErrorResponse({ title: "File too large", message: `Maximum IFC size for enhancement is ${MAX_IFC_SIZE / (1024 * 1024)} MB.`, code: "VAL_001" }),
        { status: 413 },
      );
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const headerStr = new TextDecoder().decode(buffer.slice(0, 64));
    if (!headerStr.startsWith("ISO-10303-21;")) {
      return NextResponse.json(formatErrorResponse(UserErrors.IFC_PARSE_FAILED), { status: 400 });
    }

    const ifcText = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

    // Phase 1 — plan the modification (AI if configured, heuristic otherwise)
    const plan = await planEnhancement(ifcText, prompt);

    if (plan.operations.length === 0) {
      return NextResponse.json({
        ok: false,
        operation: "none",
        message: plan.understood || "Couldn't interpret this request into any supported operation.",
        understood: plan.understood,
        notes: plan.notes,
        plannerSource: plan.source,
        plan: [],
        results: [],
        stats: { originalBytes: ifcText.length, modifiedBytes: ifcText.length },
      }, { status: 422 });
    }

    // Phase 2 — execute the plan against the open file (in place)
    const result = executePlan(ifcText, plan.operations);

    return NextResponse.json({
      ok: result.ok,
      understood: plan.understood,
      notes: plan.notes,
      plannerSource: plan.source,
      plan: plan.operations,
      results: result.results,
      summary: result.summary,
      stats: result.stats,
      modifiedText: result.modifiedText,
      filename: sanitizeFilename(file.name),
    });
  } catch (err) {
    console.error("[enhance-ifc]", err);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR, safeErrorMessage(err)),
      { status: 500 },
    );
  }
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_\-]/g, "_");
  return `${base || "model"}_enhanced.ifc`;
}
