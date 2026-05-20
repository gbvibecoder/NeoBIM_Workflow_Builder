/**
 * POST /api/brief-to-ifc/v3/agent-job
 *
 * QStash-triggered background worker for the v3 agent build.
 * Phase gamma.2: replaces the after()-based dispatch in /runs/route.ts
 * so the agent build runs in its OWN Vercel invocation (800s budget),
 * uncapped from the user's perspective.
 *
 * Pattern matches VIP pipeline (src/app/api/vip-jobs/worker/route.ts):
 *   - QStash signature verification
 *   - Load run from DB
 *   - Run the work
 *   - Write result back to DB
 *   - Return 200 (success) or 500 (QStash retries)
 *
 * The frontend polls /api/brief-to-ifc/v3/runs/{id}/status for progress
 * rather than holding an HTTP request open for the agent duration.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyQstashSignature } from "@/lib/qstash";
import { runBackground } from "@/features/brief-to-ifc/v3/runtime/background-runner";
import { runGenerator } from "@/features/brief-to-ifc/v3/generator/driver";
import { appendLog } from "@/features/brief-to-ifc/v3/runtime/append-log";
import { toBriefToIfcV3ErrorCode } from "@/features/brief-to-ifc/v3/lifecycle/error-codes";
import type { BriefSpec, AgentInputSuggestions } from "@/features/brief-to-ifc/v3/types";

export const maxDuration = 800;

export async function POST(req: NextRequest) {
  // ── QStash signature verification ──
  const rawBody = await req.text();
  const signature = req.headers.get("upstash-signature");

  const skipVerify = process.env.SKIP_QSTASH_SIG_VERIFY === "true";
  if (skipVerify && process.env.NODE_ENV === "production") {
    throw new Error(
      "SECURITY: SKIP_QSTASH_SIG_VERIFY must not be true in production",
    );
  }
  if (!skipVerify) {
    const valid = await verifyQstashSignature(signature, rawBody);
    if (!valid) {
      // eslint-disable-next-line no-console
      console.warn("[agent-job] rejected — invalid or missing QStash signature");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: { runId?: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const runId = typeof body.runId === "string" ? body.runId : null;
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  // ── Load run from DB ──
  const run = await prisma.briefToIfcV3Run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      briefSpec: true,
      costCapUsd: true,
    },
  });

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Idempotent: if already completed or failed, don't re-process
  if (run.status !== "PENDING" && run.status !== "RUNNING") {
    return NextResponse.json({
      status: run.status,
      message: "Already processed",
    });
  }

  const briefSpec = run.briefSpec as unknown as BriefSpec;
  if (!briefSpec) {
    return NextResponse.json(
      { error: "Run has no briefSpec snapshot" },
      { status: 400 },
    );
  }

  // ── Run the agent via the existing background-runner pattern ──
  try {
    await runBackground({
      prisma,
      runId,
      timeoutMs: 780_000, // 20s below Vercel's 800s ceiling
      fn: async (ctx) => {
        await ctx.log("INFO", "GENERATE", "Agent build starting (QStash worker).");
        const result = await runGenerator({
          brief: briefSpec,
          onTurn: (record) => {
            void appendLog(prisma, {
              executionId: runId,
              level: "INFO",
              source: "TOOL_CALL",
              message:
                `Turn ${record.turn}: ${record.toolName ?? "<no tool>"} ` +
                `(${record.toolDurationMs}ms, ` +
                `${record.toolOk ? "ok" : "FAIL " + (record.toolErrorType ?? "?")})`,
              metadata: {
                turn: record.turn,
                toolName: record.toolName,
                toolDurationMs: record.toolDurationMs,
                toolOk: record.toolOk,
                toolErrorType: record.toolErrorType,
              },
            });
          },
        });
        if (!result.ok) {
          throw Object.assign(
            new Error(result.error?.message ?? "generator failed"),
            { code: toBriefToIfcV3ErrorCode(result.error?.code) },
          );
        }
        return result;
      },
      toCompletedPayload: (result) => ({
        ifcUrl: result.ifcUrl ?? "",
        entityCount: result.entityCount,
        finalValidation: result.finalValidation ?? undefined,
        generatorCostUsd: result.costUsd,
        generatorMs: result.durationMs,
        turns: result.turns,
        ledger: result.ledger,
        turnRecords: result.turnRecords,
      }),
    });

    return NextResponse.json({ status: "ok", runId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[agent-job] Worker failed for run ${runId}:`, msg);
    // 500 → QStash won't retry (retries: 0) but we log it
    return NextResponse.json(
      { error: "worker error", detail: msg.slice(0, 500) },
      { status: 500 },
    );
  }
}
