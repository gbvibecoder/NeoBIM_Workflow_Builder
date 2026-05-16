/**
 * Diagnostic CLI for Brief-to-IFC v3 runs.
 *
 *   npx tsx scripts/diagnose-execution.ts <runId>
 *
 * Single-purpose triage tool — Rutik runs this when a v3 run looks
 * stuck or wrong and wants the full state in one place. The output
 * mirrors the Phase v3 observability spec's §D6 list:
 *
 *   • Run row dump (status, errorCode, durations, costs, retries)
 *   • Last 50 logs ordered by timestamp
 *   • Workflow correlation (id, owner email)
 *   • Tool-turn ledger + cost breakdown
 *   • Railway sandbox healthcheck (optional — skipped if unreachable)
 *   • Suggested next action — a single concrete recommendation
 *
 * Exit codes:
 *   0  — run is healthy / completed cleanly
 *   1  — run is stuck or failed (something needs operator action)
 *   2  — usage error (no runId, runId not found)
 */

import { prisma } from "@/lib/db";
import { isStuck, STUCK_THRESHOLD_MS } from "@/features/brief-to-ifc/v3/lifecycle/heartbeat";
import {
  isUserActionable,
  type BriefToIfcV3ErrorCode,
} from "@/features/brief-to-ifc/v3/lifecycle/error-codes";

const LOG_TAIL = 50;

interface CliExit {
  code: 0 | 1 | 2;
  reason: string;
}

async function main(runId: string): Promise<CliExit> {
  if (!runId) {
    return { code: 2, reason: "usage: diagnose-execution.ts <runId>" };
  }

  // ── 1. Run row -----------------------------------------------------
  const run = await prisma.briefToIfcV3Run.findUnique({
    where: { id: runId },
  });
  if (!run) {
    process.stderr.write(`run not found: ${runId}\n`);
    return { code: 2, reason: `run not found: ${runId}` };
  }

  printSection("RUN");
  printKv("id", run.id);
  printKv("userId", run.userId);
  printKv("workflowId", run.workflowId ?? "(none)");
  printKv("status", run.status);
  printKv("errorCode", run.errorCode ?? "(none)");
  printKv("errorMessage", truncate(run.errorMessage ?? "(none)", 200));
  printKv("createdAt", run.createdAt.toISOString());
  printKv("startedAt", run.startedAt?.toISOString() ?? "(never started)");
  printKv("completedAt", run.completedAt?.toISOString() ?? "(in flight)");
  printKv("lastHeartbeatAt", run.lastHeartbeatAt?.toISOString() ?? "(never)");
  printKv("turns", String(run.turns));
  printKv("generatorCostUsd", `$${run.generatorCostUsd.toFixed(4)}`);
  printKv("generatorMs", `${run.generatorMs} ms`);
  printKv("costCapUsd", run.costCapUsd?.toFixed(2) ?? "(default)");
  printKv("ifcUrl", run.ifcUrl ?? "(none)");
  printKv("entityCount", run.entityCount?.toString() ?? "(none)");

  // ── 2. Last N logs -------------------------------------------------
  const logs = await prisma.executionLog.findMany({
    where: { executionId: runId },
    orderBy: { timestamp: "desc" },
    take: LOG_TAIL,
  });
  printSection(`LAST ${Math.min(logs.length, LOG_TAIL)} LOGS (newest first)`);
  if (logs.length === 0) {
    process.stdout.write("(no logs persisted — possible Pusher-only stream loss or DB write failure)\n");
  }
  for (const l of logs) {
    process.stdout.write(
      `  ${l.timestamp.toISOString()}  [${l.level.padEnd(5)}]  ${l.source.padEnd(10)}  ${truncate(l.message, 180)}\n`,
    );
  }

  // ── 3. Workflow / owner correlation --------------------------------
  printSection("CORRELATION");
  if (run.workflowId) {
    const wf = await prisma.workflow.findUnique({
      where: { id: run.workflowId },
      select: { id: true, name: true, ownerId: true },
    });
    printKv("workflow.id", wf?.id ?? "(orphan)");
    printKv("workflow.name", wf?.name ?? "(unknown)");
  } else {
    process.stdout.write("(no linked workflow — direct API caller)\n");
  }
  const user = await prisma.user.findUnique({
    where: { id: run.userId },
    select: { email: true, role: true },
  });
  printKv("user.email", user?.email ?? "(unknown)");
  printKv("user.role", user?.role ?? "(unknown)");

  // ── 4. Tool ledger (v3-specific) -----------------------------------
  printSection("TOOL TURN LEDGER");
  const ledger = Array.isArray(run.ledger) ? run.ledger : [];
  if (ledger.length === 0) {
    process.stdout.write("(no turns recorded — agent loop never started or persistence failed)\n");
  } else {
    for (const entry of ledger) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const e = entry as Record<string, unknown>;
        process.stdout.write(
          `  turn ${String(e.turn ?? "?").padStart(2)}  ` +
            `cost $${(typeof e.costUsd === "number" ? e.costUsd : 0).toFixed(4)}  ` +
            `in ${String(e.inputTokens ?? "?")} / out ${String(e.outputTokens ?? "?")}  ` +
            `cache_read ${String(e.cacheReadTokens ?? 0)}  ` +
            `${String(e.durationMs ?? "?")} ms\n`,
        );
      }
    }
  }

  // ── 5. Railway sandbox healthcheck (best-effort) -------------------
  printSection("RAILWAY HEALTH");
  const ifcServiceUrl = process.env.IFC_SERVICE_URL;
  if (!ifcServiceUrl) {
    process.stdout.write("IFC_SERVICE_URL not set — sandbox health skipped.\n");
  } else {
    try {
      const res = await fetch(`${ifcServiceUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      printKv("status", `${res.status} ${res.statusText}`);
      const body = await res.text();
      printKv("body", truncate(body.replace(/\s+/g, " "), 200));
    } catch (err) {
      printKv("error", err instanceof Error ? err.message : String(err));
    }
  }

  // ── 6. Suggested next action ---------------------------------------
  printSection("SUGGESTED NEXT ACTION");
  const exit = suggestNextAction(run);
  process.stdout.write(`${exit.reason}\n`);
  return exit;
}

function suggestNextAction(run: {
  status: string;
  errorCode: string | null;
  lastHeartbeatAt: Date | null;
  costCapUsd: number | null;
}): CliExit {
  if (run.status === "COMPLETED") {
    return { code: 0, reason: "Run completed successfully. No action needed." };
  }

  if (run.status === "RUNNING") {
    if (isStuck(run.lastHeartbeatAt)) {
      const minutes = Math.round(STUCK_THRESHOLD_MS / 60_000);
      return {
        code: 1,
        reason:
          `STUCK: heartbeat older than ${minutes}m — the background runner ` +
          "likely crashed or Vercel's function timed out.\n" +
          "  Recommended: mark the run FAILED with errorCode=STUCK_NO_HEARTBEAT:\n" +
          `    UPDATE brief_to_ifc_v3_runs SET status='FAILED', errorCode='STUCK_NO_HEARTBEAT', ` +
          `errorMessage='Marked failed by diagnostic CLI' WHERE id='${(run as { id: string }).id ?? "<id>"}';\n` +
          "  Then re-run the brief from the dashboard.",
      };
    }
    return {
      code: 0,
      reason:
        "RUNNING with a fresh heartbeat — the run is healthy. " +
        "Re-run this command in 30s if you want a fresher snapshot.",
    };
  }

  if (run.status === "PENDING") {
    return {
      code: 1,
      reason:
        "STUCK IN PENDING: the background runner never claimed this row. " +
        "Most likely cause: the route returned 202 but Vercel killed the function " +
        "before `runBackground` got past `transitionStatus(PENDING -> RUNNING)`. " +
        "Recommended: check Vercel logs for the POST /api/brief-to-ifc/v3/runs request " +
        "matching this createdAt timestamp.",
    };
  }

  if (run.status === "FAILED" || run.status === "CANCELLED") {
    const code = (run.errorCode ?? "UNKNOWN") as BriefToIfcV3ErrorCode;
    const actionable = isUserActionable(code);
    return {
      code: 1,
      reason:
        `FAILED with code ${code}. ${actionable
          ? "User-actionable — the dashboard's Retry CTA is the right path."
          : "Not user-actionable — needs developer investigation."}` +
        (code === "COST_CAP_EXCEEDED"
          ? `\n  Recommended: re-run with a higher cost_cap_usd (current was ` +
            `${run.costCapUsd?.toFixed(2) ?? "default"}).`
          : "") +
        (code === "SANDBOX_TIMEOUT" || code === "SANDBOX_FAILURE"
          ? "\n  Recommended: check Railway logs for the matching session_id."
          : "") +
        (code === "STUCK_NO_HEARTBEAT"
          ? "\n  Recommended: redeploy Vercel; the function likely timed out mid-run."
          : ""),
    };
  }

  return { code: 1, reason: `Unrecognised status: ${run.status}` };
}

// --- Output helpers -------------------------------------------------

function printSection(label: string): void {
  process.stdout.write(`\n=== ${label} ===\n`);
}

function printKv(key: string, value: string): void {
  process.stdout.write(`  ${key.padEnd(20)} ${value}\n`);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3)}...`;
}

// --- Entry point ----------------------------------------------------

const runId = process.argv[2] ?? "";
main(runId)
  .then((exit) => {
    process.exit(exit.code);
  })
  .catch((err) => {
    process.stderr.write(
      `diagnose-execution: fatal: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(2);
  });
