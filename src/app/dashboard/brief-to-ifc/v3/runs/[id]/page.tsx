/**
 * /dashboard/brief-to-ifc/v3/runs/[id] — v3 run results page.
 *
 * Lives at a NEW path (NOT the canvas's `/dashboard/results/[executionId]`)
 * because v3 has its own state machine — sharing the route would risk
 * v1/v2 regressions. The canvas's result page is untouched.
 *
 * Renders 4 explicit states with distinct UI:
 *   • PENDING   — "queued" message
 *   • RUNNING   — live log pane + heartbeat indicator
 *   • COMPLETED — IFC link + entity count + cost + retry context
 *   • FAILED    — errorCode + message + retry CTA + collapsible log
 *
 * Polls `/api/brief-to-ifc/v3/runs/[id]/status` every 5s until terminal.
 */

import { redirect } from "next/navigation";

import { ExecutionRunRoot } from "./run-root";

export default async function BriefToIfcV3RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!id) redirect("/dashboard");
  return <ExecutionRunRoot runId={id} />;
}
