/**
 * POST /api/brief-to-ifc/v3/validate
 *
 * Canvas TR-027 ("Geometric Validator") endpoint.
 *
 * Reads the stored `finalValidation` from the v3 run row (looked up by
 * `ifcUrl` + `userId`) and returns a flat, canvas-friendly view of the
 * 4 brief-aware visual validators that already ran inside the v3 run
 * lifecycle. NO sandbox round-trip — validators ran when the agent
 * called `finalize_ifc`, and `BriefToIfcV3Run.finalValidation` is the
 * persisted snapshot.
 *
 * Why a separate endpoint instead of folding into `runs/[id]/status`:
 *   • TR-027 is a self-contained canvas stage. Calling /validate makes
 *     the data flow on canvas explicit (a node calls a named endpoint).
 *   • The status route's shape is intentionally narrow (lifecycle only)
 *     to keep its polling overhead low. Validation payload is verbose.
 *   • Surfacing as an endpoint lets future surfaces (CLI, evals, third
 *     parties) ask for the same shape without scraping `/status`.
 *
 * Auth: session-bound. Looks up by `ifcUrl + userId` so the user can
 * only see validation results for their own runs. Returns 404 on
 * ownership mismatch (does not distinguish from a genuine miss — same
 * shape as `/runs/[id]/status`).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { shouldUseBriefToIfcV3 } from "@/features/brief-to-ifc/v3/canary";
import type {
  SandboxValidateResult,
  SandboxWorldBboxValidation,
  SandboxOriginCollapseValidation,
  SandboxSpacePolygonValidation,
} from "@/features/brief-to-ifc/v3/types";

export const maxDuration = 30;

const NOT_AVAILABLE_ERROR = {
  title: "Feature not available",
  message: "The v3 AI IFC pipeline is not available for your account.",
  code: "BRIEF_TO_IFC_V3_NOT_AVAILABLE",
} as const;

const NOT_FOUND_ERROR = {
  title: "IFC not found",
  message: "No v3 run found for this IFC URL. Re-run the IFC Agent Builder upstream.",
  code: "BRIEF_TO_IFC_V3_RUN_NOT_FOUND",
} as const;

const NO_VALIDATION_ERROR = {
  title: "Validation unavailable",
  message:
    "This run has no stored validation payload. The agent may have skipped /validate (older runs from before the visual validators landed).",
  code: "BRIEF_TO_IFC_V3_NO_VALIDATION",
} as const;

const BODY_SCHEMA = z
  .object({
    ifcUrl: z.string().min(8).max(2000),
  })
  .strict();

/** Canvas-friendly verdict view derived from the full SandboxValidateResult. */
export interface ValidatorView {
  verdict: "OK" | "FAILED";
  worldBbox: [number, number, number] | null;
  worldBboxVerdict: SandboxWorldBboxValidation["verdict"] | null;
  polygonOk: boolean;
  originOk: boolean;
  elementCoverageOk: boolean;
  lengthUnit: string;
  failures: string[];
  /** Raw counts surfaced to canvas KPI artifact. */
  entityCount: number;
  schemaName: string | null;
}

function deriveView(
  validation: SandboxValidateResult,
): ValidatorView {
  const failures: string[] = [];

  const worldBbox = validation.world_bbox;
  const worldBboxOk = worldBbox?.verdict === "OK";
  const worldBboxArr: [number, number, number] | null = worldBbox?.actual_extent
    ? [worldBbox.actual_extent[0], worldBbox.actual_extent[1], worldBbox.actual_extent[2]]
    : null;
  if (worldBbox && !worldBboxOk) {
    failures.push(
      `world_bbox: ${worldBbox.verdict}` +
        (worldBbox.suggested_unit_fix ? ` (hint: ${worldBbox.suggested_unit_fix})` : ""),
    );
  }

  const originCollapse = validation.origin_collapse as
    | SandboxOriginCollapseValidation
    | null;
  const originOk = !originCollapse || originCollapse.verdict === "OK";
  if (originCollapse && originCollapse.verdict === "COLLAPSED") {
    failures.push(
      `origin_collapse: ${originCollapse.at_origin_count}/${originCollapse.total_elements} ` +
        `elements at (0,0,0)`,
    );
  }

  const polygons = validation.space_polygons as
    | SandboxSpacePolygonValidation[]
    | null;
  const polygonOk =
    !polygons || polygons.every((p) => p.verdict === "OK" || p.verdict === "NO_EXPECTED_POLYGON");
  if (polygons && !polygonOk) {
    const bad = polygons.filter(
      (p) => p.verdict !== "OK" && p.verdict !== "NO_EXPECTED_POLYGON",
    );
    failures.push(
      `space_polygons: ${bad.length} of ${polygons.length} spaces mismatched`,
    );
  }

  const elementCoverage = validation.element_coverage;
  const elementCoverageOk = !elementCoverage || elementCoverage.verdict === "OK";
  if (elementCoverage && elementCoverage.verdict === "MISSING_ELEMENTS") {
    failures.push(
      `element_coverage: ${elementCoverage.missing_id_count} brief elements missing in IFC`,
    );
  }

  // Only worldBbox and originCollapse are hard failures — they indicate
  // structural geometry problems (wrong units, missing geometry). Polygon
  // mismatch and element coverage are quality warnings: the agent may
  // legitimately merge adjacent spaces or skip minor elements, and the
  // wall-thickness tolerance makes polygon deltas expected.
  const hardFailure = !worldBboxOk || !originOk;
  const verdict: "OK" | "FAILED" = hardFailure ? "FAILED" : "OK";

  // Length unit isn't directly on the validate result — but world_bbox
  // verdict implicitly proves it: an OK world bbox means the IFC was
  // written in METRE (the post-fix unit), since the bbox passes the
  // ±5% match against the brief's metre-scale dimensions.
  const lengthUnit = worldBboxOk ? "METRE" : "UNKNOWN";

  return {
    verdict,
    worldBbox: worldBboxArr,
    worldBboxVerdict: worldBbox?.verdict ?? null,
    polygonOk,
    originOk,
    elementCoverageOk,
    lengthUnit,
    failures,
    entityCount: validation.entity_count ?? 0,
    schemaName: validation.schema_name ?? null,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), {
      status: 401,
    });
  }
  if (!shouldUseBriefToIfcV3(session.user.email ?? null)) {
    return NextResponse.json(formatErrorResponse(NOT_AVAILABLE_ERROR), {
      status: 403,
    });
  }

  let body: z.infer<typeof BODY_SCHEMA>;
  try {
    const json = await req.json();
    const parsed = BODY_SCHEMA.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.MISSING_REQUIRED_FIELD("ifcUrl")),
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(formatErrorResponse(UserErrors.INVALID_INPUT), {
      status: 400,
    });
  }

  const run = await prisma.briefToIfcV3Run.findFirst({
    where: { ifcUrl: body.ifcUrl, userId: session.user.id },
    select: { id: true, finalValidation: true, status: true },
    orderBy: { createdAt: "desc" },
  });

  if (!run) {
    return NextResponse.json(formatErrorResponse(NOT_FOUND_ERROR), { status: 404 });
  }

  if (!run.finalValidation) {
    return NextResponse.json(formatErrorResponse(NO_VALIDATION_ERROR), {
      status: 404,
    });
  }

  // `finalValidation` is JSON on disk — cast through the typed shape.
  const validation = run.finalValidation as unknown as SandboxValidateResult;
  const view = deriveView(validation);

  return NextResponse.json(
    {
      runId: run.id,
      ifcUrl: body.ifcUrl,
      validator: view,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
