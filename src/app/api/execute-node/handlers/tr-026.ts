/**
 * TR-026 — IFC Agent Builder (v3 Layer 2)
 *
 * Phase gamma.2: ASYNC handler. Submits the run to /api/brief-to-ifc/v3/runs
 * (which dispatches the agent via QStash) and returns immediately with a
 * `pendingRunId`. The frontend polls the run status client-side until
 * completion. No server-side polling — the execute-node function releases
 * in ~2 seconds instead of blocking for 10-25 minutes.
 *
 * Inputs:
 *   • `briefSpec: object`   — required, from TR-025
 *   • `cost_cap_usd: number` — optional
 *   • `max_turns: number`    — optional
 */

import { headers } from "next/headers";

import type { NodeHandler } from "./types";
import type { BriefSpec } from "@/features/brief-to-ifc/v3/types";

async function getOriginAndCookie(): Promise<{ origin: string; cookie: string }> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    new URL(process.env.NEXTAUTH_URL ?? "https://trybuildflow.in").host;
  return { origin: `${proto}://${host}`, cookie: h.get("cookie") ?? "" };
}

export const handleTR026: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const briefSpec =
    inputData?.briefSpec && typeof inputData.briefSpec === "object"
      ? inputData.briefSpec
      : null;

  if (!briefSpec) {
    throw new Error(
      "TR-026 (IFC Agent Builder) requires a `briefSpec` from upstream TR-025 (Brief Enricher).",
    );
  }

  // Phase gamma.2: Submit the run and return immediately.
  // The /runs endpoint creates a DB row, dispatches the agent build via
  // QStash, and returns 202 with the runId. The actual agent runs in a
  // separate Vercel invocation (800s each, uncapped total).
  const { origin, cookie } = await getOriginAndCookie();

  const body: Record<string, unknown> = { briefSpec };
  if (typeof inputData?.cost_cap_usd === "number") body.cost_cap_usd = inputData.cost_cap_usd;
  if (typeof inputData?.max_turns === "number") body.max_turns = inputData.max_turns;

  const createRes = await fetch(`${origin}/api/brief-to-ifc/v3/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });

  if (!createRes.ok) {
    const errPayload = await createRes.json().catch(() => ({})) as {
      error?: { message?: string; code?: string };
    };
    throw new Error(
      `TR-026: /runs submission failed (HTTP ${createRes.status}): ` +
      `${errPayload.error?.message ?? "unknown"} (${errPayload.error?.code ?? "?"})`,
    );
  }

  const created = await createRes.json() as {
    runId: string;
    status: string;
    statusUrl: string;
  };

  // eslint-disable-next-line no-console
  console.info(`[tr-026] Run submitted: ${created.runId} — returning immediately (async build)`);

  // Return a "pending" artifact. The frontend detects `pendingRunId`
  // and polls /runs/{id}/status client-side until COMPLETED/FAILED.
  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "file",
    dataUri: undefined,
    data: {
      ifcUrl: null,
      runId: created.runId,
      pendingRunId: created.runId,
      statusUrl: created.statusUrl,
      entityCount: 0,
      turns: 0,
      generatorCostUsd: 0,
      generatorMs: 0,
      runUrl: `/dashboard/brief-to-ifc/v3/runs/${created.runId}`,
      summary: "Agent build queued — running in background...",
    },
    metadata: {
      stage: "agent-builder-queued",
      filename: `ai-ifc-${tileInstanceId}.ifc`,
      mimeType: "application/x-step",
      pendingRunId: created.runId,
      generatorVersion: "v3",
      runId: created.runId,
    },
    createdAt: new Date(),
  };
};
