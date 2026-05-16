/**
 * GN-013 — AI IFC Generator (Brief-to-IFC v3)
 *
 * Canvas node that calls the v3 SYNCHRONOUS endpoint
 *   `POST /api/brief-to-ifc/v3/generate`
 * with the user's session cookie, awaits the full agent-loop result
 * inline (it returns one JSON when the loop terminates), and emits a
 * single `file` artifact with the IFC URL + cost/entity/turn metadata.
 *
 * Input shapes (one of):
 *   • { brief: string }       — free text; runs Layer 1 enrichment server-side
 *   • { briefSpec: object }   — pre-enriched BriefSpec, skips Layer 1
 *   • { content: string }     — alias for `brief` (matches the output port
 *                                of upstream nodes like TR-001 Brief Parser)
 *
 * The sync endpoint already enforces auth + canary + rate-limit; the
 * canvas dispatcher's own auth covers the user, and we forward the
 * session cookie so the downstream auth() call resolves.
 *
 * NB: To make this node executable on the canvas, `GN-013` must be
 * added to `REAL_NODE_IDS` in `src/app/api/execute-node/route.ts`.
 * That file is forbidden by the current phase prompt — the gap is
 * documented in the closeout report. Until that one-line addition
 * lands, the catalogue entry is visible on the picker but the
 * dispatcher rejects the run with `NODE_NOT_IMPLEMENTED`.
 */

import { headers } from "next/headers";

import type { NodeHandler } from "./types";

interface GenerateResponse {
  ok: boolean;
  ifcUrl: string | null;
  entityCount: number;
  costUsd: number;
  durationMs: number;
  turns: number;
  finalValidation: unknown;
  error: { code?: string; message?: string } | null;
}

async function getOriginAndCookie(): Promise<{
  origin: string;
  cookie: string;
}> {
  // next/headers is an async API in Next.js 15+. Call it with await.
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    new URL(process.env.NEXTAUTH_URL ?? "https://trybuildflow.in").host;
  return {
    origin: `${proto}://${host}`,
    cookie: h.get("cookie") ?? "",
  };
}

export const handleGN013: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const brief =
    typeof inputData?.brief === "string" && inputData.brief.trim().length > 40
      ? inputData.brief.trim()
      : typeof inputData?.content === "string" &&
          inputData.content.trim().length > 40
        ? inputData.content.trim()
        : null;
  const briefSpec =
    inputData?.briefSpec && typeof inputData.briefSpec === "object"
      ? inputData.briefSpec
      : null;

  if (!brief && !briefSpec) {
    throw new Error(
      "GN-013 needs `brief` (>=40 chars), `briefSpec`, or `content` from an upstream node.",
    );
  }

  const body: Record<string, unknown> = brief ? { brief } : { briefSpec };
  if (typeof inputData?.cost_cap_usd === "number") {
    body.cost_cap_usd = inputData.cost_cap_usd;
  }
  if (typeof inputData?.max_turns === "number") {
    body.max_turns = inputData.max_turns;
  }

  const { origin, cookie } = await getOriginAndCookie();
  const res = await fetch(`${origin}/api/brief-to-ifc/v3/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new Error(
      `AI IFC v3 generation failed (HTTP ${res.status}): ` +
        `${payload.error?.message ?? "unknown"} (${payload.error?.code ?? "?"})`,
    );
  }
  const result = (await res.json()) as GenerateResponse;
  if (!result.ok || !result.ifcUrl) {
    throw new Error(
      `AI IFC v3 generation did not produce a file: ` +
        `${result.error?.message ?? "no IFC URL returned"} ` +
        `(${result.error?.code ?? "?"})`,
    );
  }

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "file",
    dataUri: result.ifcUrl,
    data: {
      ifcUrl: result.ifcUrl,
      entityCount: result.entityCount,
      generatorCostUsd: result.costUsd,
      generatorMs: result.durationMs,
      turns: result.turns,
      finalValidation: result.finalValidation,
      summary:
        `AI IFC generated. ${result.entityCount} entities, ` +
        `${result.turns} turns, $${result.costUsd.toFixed(3)}.`,
    },
    metadata: {
      filename: `ai-ifc-${tileInstanceId}.ifc`,
      mimeType: "application/x-step",
      entityCount: result.entityCount,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      generatorVersion: "v3",
    },
    createdAt: new Date(),
  };
};
