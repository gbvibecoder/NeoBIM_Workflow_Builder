/**
 * TR-027 — Geometric Validator
 *
 * Canvas-visible decomposition of the v3 visual gates. Reads the
 * persisted `finalValidation` from the run row produced by TR-026
 * upstream — no sandbox round-trip. Surfaces the verdict, world bbox,
 * length unit, and a list of failure strings as a KPI artifact on
 * canvas.
 *
 * Inputs (from TR-026 upstream artifact):
 *   • `ifcUrl: string`  — required, identifies the run row
 *   • `runId: string`   — optional, passed through to the validator view
 */

import { headers } from "next/headers";

import type { NodeHandler } from "./types";
import type { ValidatorView } from "@/app/api/brief-to-ifc/v3/validate/route";

interface ValidateResponse {
  runId: string;
  ifcUrl: string;
  validator: ValidatorView;
}

async function getOriginAndCookie(): Promise<{ origin: string; cookie: string }> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    new URL(process.env.NEXTAUTH_URL ?? "https://trybuildflow.in").host;
  return { origin: `${proto}://${host}`, cookie: h.get("cookie") ?? "" };
}

export const handleTR027: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const ifcUrl =
    typeof inputData?.ifcUrl === "string" && inputData.ifcUrl.length > 8
      ? inputData.ifcUrl
      : null;

  if (!ifcUrl) {
    throw new Error(
      "TR-027 (Geometric Validator) requires an `ifcUrl` from upstream TR-026 (IFC Agent Builder).",
    );
  }

  const { origin, cookie } = await getOriginAndCookie();
  const res = await fetch(`${origin}/api/brief-to-ifc/v3/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ ifcUrl }),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new Error(
      `Geometric validation lookup failed (HTTP ${res.status}): ${payload.error?.message ?? "unknown"} (${payload.error?.code ?? "?"})`,
    );
  }
  const result = (await res.json()) as ValidateResponse;
  const v = result.validator;

  const bboxLabel = v.worldBbox
    ? `${v.worldBbox[0].toFixed(2)} × ${v.worldBbox[1].toFixed(2)} × ${v.worldBbox[2].toFixed(2)} m`
    : "n/a";

  const summary =
    v.verdict === "OK"
      ? `All validators passed — bbox ${bboxLabel}, unit ${v.lengthUnit}, ${v.entityCount} entities.`
      : `${v.failures.length} validator failure${v.failures.length === 1 ? "" : "s"}: ${v.failures.join("; ")}`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "json",
    data: {
      // Pass through ifcUrl so EX-007 downstream can pick it up.
      ifcUrl,
      runId: result.runId,
      verdict: v.verdict,
      worldBbox: v.worldBbox,
      worldBboxVerdict: v.worldBboxVerdict,
      polygonOk: v.polygonOk,
      originOk: v.originOk,
      elementCoverageOk: v.elementCoverageOk,
      lengthUnit: v.lengthUnit,
      failures: v.failures,
      entityCount: v.entityCount,
      schemaName: v.schemaName,
      bboxLabel,
      summary,
    },
    metadata: {
      stage: "geometric-validator",
      verdict: v.verdict,
      worldBboxVerdict: v.worldBboxVerdict ?? "UNKNOWN",
      lengthUnit: v.lengthUnit,
    },
    createdAt: new Date(),
  };
};
