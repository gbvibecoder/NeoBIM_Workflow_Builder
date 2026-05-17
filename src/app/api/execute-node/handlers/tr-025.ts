/**
 * TR-025 — Brief Enricher (v3 Layer 1)
 *
 * Canvas-visible decomposition of what GN-013 used to hide: this node
 * takes a free-text brief from the upstream input node and runs Layer 1
 * enrichment via `POST /api/brief-to-ifc/v3/enrich`. Output is a
 * structured BriefSpec that flows into TR-026 (Agent Builder).
 *
 * The handler is THIN — all enrichment logic lives in the v3 backend
 * (`features/brief-to-ifc/v3/brief-enrichment.ts`). This file is the
 * canvas-side dispatcher only.
 *
 * Inputs (any one):
 *   • `briefText: string`   — canonical (from IN-009)
 *   • `brief: string`       — alias (from raw text inputs)
 *   • `content: string`     — alias (from TR-001 Brief Parser)
 *   • `inputValue: string`  — alias (from IN-001 raw text)
 */

import { headers } from "next/headers";

import type { NodeHandler } from "./types";

interface EnrichResponse {
  brief: unknown;
  costUsd: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
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

function extractBrief(inputData: Record<string, unknown> | null): string | null {
  if (!inputData) return null;
  const candidates = [
    inputData.briefText,
    inputData.brief,
    inputData.content,
    inputData.inputValue,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length >= 40) {
      return c.trim();
    }
  }
  return null;
}

export const handleTR025: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const brief = extractBrief(inputData);
  if (!brief) {
    throw new Error(
      "TR-025 (Brief Enricher) needs a brief of at least 40 characters from an upstream input node (IN-009, IN-001, or TR-001).",
    );
  }

  const { origin, cookie } = await getOriginAndCookie();
  const res = await fetch(`${origin}/api/brief-to-ifc/v3/enrich`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ brief }),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new Error(
      `Brief enrichment failed (HTTP ${res.status}): ${payload.error?.message ?? "unknown"} (${payload.error?.code ?? "?"})`,
    );
  }
  const result = (await res.json()) as EnrichResponse;

  // Surface useful KPIs derived from the BriefSpec for the canvas card.
  const briefSpec = result.brief as
    | {
        project?: { name?: string; type?: string };
        spaces?: unknown[];
        elements?: unknown[];
        materials?: unknown[];
      }
    | null;
  const spaceCount = Array.isArray(briefSpec?.spaces) ? briefSpec!.spaces!.length : 0;
  const elementCount = Array.isArray(briefSpec?.elements)
    ? briefSpec!.elements!.length
    : 0;
  const materialCount = Array.isArray(briefSpec?.materials)
    ? briefSpec!.materials!.length
    : 0;

  const summary =
    `BriefSpec ready — ${spaceCount} spaces, ${elementCount} elements, ` +
    `${materialCount} materials. ($${result.costUsd.toFixed(3)})`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "json",
    data: {
      briefSpec,
      project: briefSpec?.project,
      spaceCount,
      elementCount,
      materialCount,
      enrichmentCostUsd: result.costUsd,
      enrichmentMs: result.durationMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      summary,
    },
    metadata: {
      stage: "brief-enrichment",
      costUsd: result.costUsd,
      durationMs: result.durationMs,
    },
    createdAt: new Date(),
  };
};
