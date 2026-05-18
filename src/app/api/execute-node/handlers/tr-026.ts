/**
 * TR-026 — IFC Agent Builder (v3 Layer 2)
 *
 * Canvas-visible decomposition of the v3 agent loop: takes a BriefSpec
 * from TR-025 and produces an IFC2X3 URL by submitting a run to
 * `POST /api/brief-to-ifc/v3/runs` and polling `/status` until terminal.
 *
 * Architectural decision (Canvas Unification phase): SYNC handler with
 * server-side polling, not full async-with-Pusher. The handler awaits
 * the agent's completion inside the request (Vercel `maxDuration` is
 * 600 s in the dispatcher, which comfortably covers 30-150 s agent
 * runs). Live in-flight streaming is a follow-up polish phase — for
 * now the canvas node shows a spinner during execution and surfaces
 * the per-stage KPI on completion.
 *
 * Inputs:
 *   • `briefSpec: object`   — required, from TR-025
 *   • `cost_cap_usd: number` — optional, defaults to 3 on the server
 *   • `max_turns: number`    — optional
 *   • `workflow_id: string`  — optional correlation id
 */

/**
 * TR-026 — IFC Agent Builder (v3 Layer 2)
 *
 * Canvas-visible node that takes a BriefSpec and produces an IFC2X3 URL
 * by delegating to `runAgentBuild()` — the shared callable extracted in
 * Phase Beta 3 so both the canvas handler and the iterative rebuild
 * orchestrator (TR-033) use the same code path.
 */

import { headers } from "next/headers";

import type { NodeHandler } from "./types";
import { briefSpecSchema } from "@/features/brief-to-ifc/v3/types";
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

  const { origin, cookie } = await getOriginAndCookie();

  const { runAgentBuild } = await import("@/features/brief-to-ifc/v3/agent-build");

  const result = await runAgentBuild(briefSpec as BriefSpec, {
    iteration: 1,
    maxTurns: typeof inputData?.max_turns === "number" ? inputData.max_turns : undefined,
    costCapUsd: typeof inputData?.cost_cap_usd === "number" ? inputData.cost_cap_usd : undefined,
    origin,
    cookie,
  });

  const summary =
    `IFC generated — ${result.entityCount} entities, ` +
    `${result.turns} turn${result.turns === 1 ? "" : "s"}, ` +
    `$${result.costUsd.toFixed(3)}.`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "file",
    dataUri: result.ifcUrl,
    data: {
      ifcUrl: result.ifcUrl,
      runId: result.runId,
      entityCount: result.entityCount,
      turns: result.turns,
      generatorCostUsd: result.costUsd,
      generatorMs: result.elapsedMs,
      runUrl: `/dashboard/brief-to-ifc/v3/runs/${result.runId}`,
      summary,
    },
    metadata: {
      stage: "agent-builder",
      filename: `ai-ifc-${tileInstanceId}.ifc`,
      mimeType: "application/x-step",
      entityCount: result.entityCount,
      costUsd: result.costUsd,
      durationMs: result.elapsedMs,
      generatorVersion: "v3",
      runId: result.runId,
    },
    createdAt: new Date(),
  };
};
