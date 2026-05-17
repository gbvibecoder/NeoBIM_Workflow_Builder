/**
 * POST /api/brief-to-ifc-job/worker — RETIRED 2026-05-17.
 *
 * The v2 queued IFC pipeline was retired. This endpoint returns HTTP
 * 410 Gone, which short-circuits any in-flight QStash callbacks
 * scheduled before the retirement. The orchestrator + worker code is
 * preserved in `src/features/ifc/services/brief-to-ifc-v2/` for audit
 * but is no longer reachable through any HTTP path.
 *
 * Returning 410 (not 200) signals to QStash that the resource is
 * permanently gone; QStash will not retry a 410 response.
 */

export const maxDuration = 30;

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "PIPELINE_RETIRED",
      message:
        "The v2 IFC pipeline worker was retired on 2026-05-17. Submissions go through /api/brief-to-ifc/v3/runs.",
      replacement: "/api/brief-to-ifc/v3/runs",
    },
    { status: 410 },
  );
}
