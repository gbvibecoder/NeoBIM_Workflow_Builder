/**
 * TR-024 — Brief Enricher (v2 IFC pipeline) — RETIRED 2026-05-17.
 *
 * The v2 pipeline (TR-024 → TR-022 → EX-006) produced broken
 * millimetre-scale IFCs. v3 (GN-013 AI IFC Generator) supersedes it
 * with one node that runs enrichment + script + sandbox + geometric
 * validators internally.
 *
 * This handler now returns HTTP 410 Gone. Any workflow still wired to
 * TR-024 should be upgraded via the deprecation banner's "Upgrade
 * workflow" button, which swaps the v2 chain for a single GN-013 node.
 *
 * The original v2 enricher source lives in git history at this path
 * pre-`PHASE_V2_RETIRED_2026-05-17.md`. The orchestrator service at
 * `src/features/ifc/services/brief-to-ifc-v2/` is preserved for audit
 * but is no longer reachable through this canvas handler.
 */

import { NextResponse, formatErrorResponse } from "./deps";
import type { NodeHandler } from "./types";

export const handleTR024: NodeHandler = async () => {
  return NextResponse.json(
    formatErrorResponse({
      title: "v2 IFC pipeline retired",
      message:
        "Brief Enricher (TR-024) was retired on 2026-05-17. Upgrade this workflow with the banner's 'Upgrade workflow' button, or use the new AI IFC Generator node (GN-013).",
      code: "PIPELINE_RETIRED",
    }),
    { status: 410 },
  );
};
