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

import { headers } from "next/headers";

import type { NodeHandler } from "./types";

interface RunsCreateResponse {
  runId: string;
  status: "PENDING" | "RUNNING";
  statusUrl: string;
}

interface RunStatusView {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  ifcUrl: string | null;
  entityCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  generatorCostUsd: number;
  generatorMs: number;
  turns: number;
}

const POLL_INITIAL_MS = 3_000;
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_INTERVAL_MS = 8_000;
const POLL_TIMEOUT_MS = 500_000; // 500 s — comfortably covers worst-case agent runs.

async function getOriginAndCookie(): Promise<{ origin: string; cookie: string }> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    new URL(process.env.NEXTAUTH_URL ?? "https://trybuildflow.in").host;
  return { origin: `${proto}://${host}`, cookie: h.get("cookie") ?? "" };
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const handleTR026: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  // Accept the BriefSpec either as the upstream output's primary object
  // (`briefSpec`) or as the data envelope (handlers/index passes the
  // upstream artifact's `data` field as `inputData`).
  const briefSpec =
    inputData?.briefSpec && typeof inputData.briefSpec === "object"
      ? inputData.briefSpec
      : null;

  if (!briefSpec) {
    throw new Error(
      "TR-026 (IFC Agent Builder) requires a `briefSpec` from upstream TR-025 (Brief Enricher).",
    );
  }

  // /api/brief-to-ifc/v3/runs uses a zod `.strict()` schema, so any
  // extra key (e.g. an analytics-style `source: "canvas"` tag) is
  // rejected with HTTP 400 before the agent ever starts. Keep this body
  // strictly aligned with the endpoint's accepted keys.
  const body: Record<string, unknown> = { briefSpec };
  if (typeof inputData?.cost_cap_usd === "number") {
    body.cost_cap_usd = inputData.cost_cap_usd;
  }
  if (typeof inputData?.max_turns === "number") {
    body.max_turns = inputData.max_turns;
  }
  if (typeof inputData?.workflow_id === "string") {
    body.workflow_id = inputData.workflow_id;
  }

  const { origin, cookie } = await getOriginAndCookie();

  // 1. Kick off the run.
  const createRes = await fetch(`${origin}/api/brief-to-ifc/v3/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  if (!createRes.ok) {
    const payload = (await createRes.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new Error(
      `Agent run submission failed (HTTP ${createRes.status}): ` +
        `${payload.error?.message ?? "unknown"} (${payload.error?.code ?? "?"})`,
    );
  }
  const created = (await createRes.json()) as RunsCreateResponse;

  // 2. Poll /status until terminal.
  await delay(POLL_INITIAL_MS);

  const started = Date.now();
  let interval = POLL_INTERVAL_MS;
  let last: RunStatusView | null = null;
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const statusRes = await fetch(
      `${origin}/api/brief-to-ifc/v3/runs/${created.runId}/status`,
      { headers: { cookie } },
    );
    if (!statusRes.ok) {
      // Transient 5xx — back off; 4xx means we have no chance.
      if (statusRes.status >= 500) {
        await delay(interval);
        interval = Math.min(POLL_MAX_INTERVAL_MS, interval + 1_000);
        continue;
      }
      throw new Error(
        `Run status polling failed (HTTP ${statusRes.status}) for run ${created.runId}.`,
      );
    }
    last = (await statusRes.json()) as RunStatusView;
    if (
      last.status === "COMPLETED" ||
      last.status === "FAILED" ||
      last.status === "CANCELLED"
    ) {
      break;
    }
    await delay(interval);
    // Gentle backoff — agent runs tend to land in 30-150 s; longer
    // intervals reduce Vercel cold-start chatter without delaying
    // perceptible completion much.
    interval = Math.min(POLL_MAX_INTERVAL_MS, interval + 500);
  }

  if (!last) {
    throw new Error(
      `Agent run ${created.runId} produced no status response within the polling window.`,
    );
  }

  if (last.status !== "COMPLETED" || !last.ifcUrl) {
    throw new Error(
      `Agent run ${created.runId} ended with status=${last.status}` +
        (last.errorMessage ? `: ${last.errorMessage}` : "") +
        (last.errorCode ? ` (${last.errorCode})` : ""),
    );
  }

  const summary =
    `IFC generated — ${last.entityCount ?? 0} entities, ` +
    `${last.turns} turn${last.turns === 1 ? "" : "s"}, ` +
    `$${last.generatorCostUsd.toFixed(3)}.`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "file",
    dataUri: last.ifcUrl,
    data: {
      ifcUrl: last.ifcUrl,
      runId: last.id,
      entityCount: last.entityCount ?? 0,
      turns: last.turns,
      generatorCostUsd: last.generatorCostUsd,
      generatorMs: last.generatorMs,
      runUrl: `/dashboard/brief-to-ifc/v3/runs/${last.id}`,
      summary,
    },
    metadata: {
      stage: "agent-builder",
      filename: `ai-ifc-${tileInstanceId}.ifc`,
      mimeType: "application/x-step",
      entityCount: last.entityCount ?? 0,
      costUsd: last.generatorCostUsd,
      durationMs: last.generatorMs,
      generatorVersion: "v3",
      runId: last.id,
    },
    createdAt: new Date(),
  };
};
