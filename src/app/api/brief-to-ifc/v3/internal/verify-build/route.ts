/**
 * POST /api/brief-to-ifc/v3/internal/verify-build
 *
 * Internal endpoint that proxies to the Railway Python verifier service.
 * Body: { ifcUrl: string, spec: BriefSpec, tolerance?: { dim_m, parts_min_fraction } }
 * Returns: VerifierReport
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifierReportSchema } from "@/features/brief-to-ifc/v3/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: "AUTH_001", message: "Unauthorized" } }, { status: 401 });
  }

  let body: { ifcUrl?: string; spec?: unknown; tolerance?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "VAL_001", message: "Invalid JSON body" } }, { status: 400 });
  }

  if (!body.ifcUrl || typeof body.ifcUrl !== "string" || body.ifcUrl.length < 8) {
    return NextResponse.json({ error: { code: "VAL_001", message: "Missing or invalid ifcUrl" } }, { status: 400 });
  }

  const sandboxUrl = process.env.NEOBIM_IFC_SERVICE_URL;
  if (!sandboxUrl) {
    return NextResponse.json({ error: { code: "CONFIG_001", message: "NEOBIM_IFC_SERVICE_URL not configured" } }, { status: 503 });
  }

  try {
    const res = await fetch(`${sandboxUrl}/api/v3/verifier/check-build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ifc_url: body.ifcUrl,
        spec: body.spec ?? {},
        tolerance: body.tolerance ?? { dim_m: 0.1, parts_min_fraction: 0.7 },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: { code: "VERIFIER_001", message: `Railway verifier returned ${res.status}` } },
        { status: 502 },
      );
    }

    const data = await res.json();
    const parsed = verifierReportSchema.safeParse(data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VERIFIER_002", message: "Verifier response failed schema validation" } },
        { status: 502 },
      );
    }

    return NextResponse.json(parsed.data);
  } catch (err) {
    return NextResponse.json(
      { error: { code: "NET_001", message: `Verifier unreachable: ${err instanceof Error ? err.message : "unknown"}` } },
      { status: 502 },
    );
  }
}
