/**
 * EX-006 — AI IFC Generator (v2 sandbox executor) — RETIRED 2026-05-17.
 *
 * The v2 pipeline (TR-024 → TR-022 → EX-006) produced broken
 * millimetre-scale IFCs. The v3 canvas chain (TR-025 → TR-026 → TR-027
 * → EX-007) supersedes it with four transparent stages.
 *
 * This handler now returns HTTP 410 Gone. The original sandbox executor
 * source lives in git history at this path; the underlying client at
 * `src/features/ifc/services/brief-to-ifc-v2/ifc-sandbox-client.ts` is
 * preserved for audit but no longer reachable through this handler.
 */

import { NextResponse, formatErrorResponse } from "./deps";
import type { NodeHandler } from "./types";

export const handleEX006: NodeHandler = async () => {
  return NextResponse.json(
    formatErrorResponse({
      title: "v2 IFC pipeline retired",
      message:
        "AI IFC Generator (EX-006, v2) was retired on 2026-05-17. Upgrade this workflow with the banner's 'Upgrade workflow' button, or load the AI-Powered IFC template (5 canvas nodes) from /dashboard/templates.",
      code: "PIPELINE_RETIRED",
    }),
    { status: 410 },
  );
};
