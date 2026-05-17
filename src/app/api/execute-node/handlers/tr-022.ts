/**
 * TR-022 — IFC Architect (v2 IFC pipeline) — RETIRED 2026-05-17.
 *
 * The v2 pipeline (TR-024 → TR-022 → EX-006) produced broken
 * millimetre-scale IFCs. The v3 canvas chain (TR-025 → TR-026 → TR-027
 * → EX-007) supersedes it.
 *
 * This handler now returns HTTP 410 Gone. The original IFC-architect
 * agent loop source lives in git history at this path; the underlying
 * service module at `src/features/ifc/services/brief-to-ifc-v2/` is
 * preserved for audit but no longer reachable through this handler.
 */

import { NextResponse, formatErrorResponse } from "./deps";
import type { NodeHandler } from "./types";

export const handleTR022: NodeHandler = async () => {
  return NextResponse.json(
    formatErrorResponse({
      title: "v2 IFC pipeline retired",
      message:
        "IFC Architect (TR-022) was retired on 2026-05-17. Upgrade this workflow with the banner's 'Upgrade workflow' button, or load the AI-Powered IFC template (5 canvas nodes) from /dashboard/templates.",
      code: "PIPELINE_RETIRED",
    }),
    { status: 410 },
  );
};
