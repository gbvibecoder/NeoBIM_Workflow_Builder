/**
 * POST /api/brief-to-ifc/v3/agent-job
 *
 * QStash-triggered background worker for the v3 agent build.
 *
 * Phase gamma.3: restores the FULL γ.1 Direct Agent Mode input
 * architecture (briefText + suggestions + previousFeedback + iteration)
 * AND the post-build verify→hint→iterate quality loop.
 *
 * γ.2 was a minimal shell that passed only { brief: briefSpec } and
 * shipped the first build unchecked (quality 45, proven on cmpdqhfx).
 * This worker now replicates the complete self-correcting pipeline.
 *
 * Flow per iteration:
 *   1. runGenerator (with briefText + suggestions + feedback)
 *   2. verifyBuild (hard verifier)
 *   3. if quality >= QUALITY_THRESHOLD or iteration >= MAX_ITERATIONS → done
 *   4. else: generateRetryHint → re-run with feedback
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyQstashSignature } from "@/lib/qstash";
import type { AgentBuildWorkerPayload } from "@/lib/qstash";
import { runBackground } from "@/features/brief-to-ifc/v3/runtime/background-runner";
import { runGenerator } from "@/features/brief-to-ifc/v3/generator/driver";
import type { GeneratorResult } from "@/features/brief-to-ifc/v3/types";
import { appendLog } from "@/features/brief-to-ifc/v3/runtime/append-log";
import { toBriefToIfcV3ErrorCode } from "@/features/brief-to-ifc/v3/lifecycle/error-codes";
import { verifyBuild } from "@/features/brief-to-ifc/v3/hard-verifier";
import { generateRetryHint } from "@/features/brief-to-ifc/v3/retry-hint";
import { QUALITY_THRESHOLD, MAX_ITERATIONS } from "@/features/brief-to-ifc/v3/constants";
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

  let payload: AgentBuildWorkerPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const runId = typeof payload.runId === "string" ? payload.runId : null;
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  // ── Extract γ.1 Direct Agent Mode fields from the QStash payload ──
  const briefText = typeof payload.briefText === "string" ? payload.briefText : undefined;
  const suggestions = payload.suggestions as AgentInputSuggestions | undefined;
  const initialIteration = typeof payload.iteration === "number" ? payload.iteration : 1;
  const initialFeedback = typeof payload.previousFeedback === "string" ? payload.previousFeedback : undefined;

  // ── Load run from DB ──
  const run = await prisma.briefToIfcV3Run.findUnique({
    where: { id: runId },
    select: { id: true, status: true, briefSpec: true, costCapUsd: true },
  });

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  if (run.status !== "PENDING" && run.status !== "RUNNING") {
    return NextResponse.json({ status: run.status, message: "Already processed" });
  }

  const briefSpec = run.briefSpec as unknown as BriefSpec;
  if (!briefSpec) {
    return NextResponse.json({ error: "Run has no briefSpec snapshot" }, { status: 400 });
  }

  // ── Run the agent with the full γ.1 input + quality loop ──
  try {
    await runBackground({
      prisma,
      runId,
      timeoutMs: 780_000,
      fn: async (ctx) => {
        await ctx.log("INFO", "GENERATE", `Agent build starting (γ.3 worker). briefText=${briefText ? `${briefText.length}ch` : "absent"}, iteration=${initialIteration}`);

        let iteration = initialIteration;
        let previousFeedback = initialFeedback;
        let bestResult: GeneratorResult | null = null;
        let bestQuality = 0;

        for (let i = 0; i < MAX_ITERATIONS; i++) {
          await ctx.log("INFO", "GENERATE", `Iteration ${iteration} starting...`);

          const result = await runGenerator({
            brief: briefSpec,
            briefText,
            suggestions,
            previousFeedback,
            iteration,
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
                  iteration,
                },
              });
            },
          });

          if (!result.ok) {
            await ctx.log("ERROR", "GENERATE", `Iteration ${iteration} generator failed: ${result.error?.message}`);
            if (!bestResult) {
              throw Object.assign(
                new Error(result.error?.message ?? "generator failed"),
                { code: toBriefToIfcV3ErrorCode(result.error?.code) },
              );
            }
            break; // Use best previous result
          }

          // ── Post-build: Hard Verifier ──
          let qualityScore = 0;
          try {
            const verifierReport = await verifyBuild(result.ifcUrl!, briefSpec);
            qualityScore = Math.round(
              verifierReport.parts_coverage * 80 +
              (verifierReport.verified ? 20 : 0),
            );

            await ctx.log("INFO", "GENERATE",
              `Iteration ${iteration} verified: quality=${qualityScore}, ` +
              `parts_coverage=${verifierReport.parts_coverage}, ` +
              `entities=${result.entityCount}, turns=${result.turns}`);

            // Track best
            if (qualityScore > bestQuality || !bestResult) {
              bestResult = result;
              bestQuality = qualityScore;
            }

            // ── Quality gate: done if good enough ──
            if (qualityScore >= QUALITY_THRESHOLD) {
              await ctx.log("INFO", "GENERATE",
                `Quality ${qualityScore} >= ${QUALITY_THRESHOLD}. Build accepted.`);
              break;
            }

            // ── More iterations available? ──
            if (iteration >= MAX_ITERATIONS) {
              await ctx.log("INFO", "GENERATE",
                `Max iterations (${MAX_ITERATIONS}) reached. Using best (quality=${bestQuality}).`);
              break;
            }

            // ── Generate retry hint for next iteration ──
            const hintResult = await generateRetryHint({
              brief: briefText || briefSpec.project?.description || "",
              iteration,
              previousIfcUrl: result.ifcUrl!,
              verifierReport,
              visionReport: {
                quality_score: qualityScore,
                pass: false,
                issues: [],
                summary: `Quality ${qualityScore} below threshold`,
                inspected_at: new Date().toISOString(),
              },
              qualityScore,
            });

            if (hintResult.shouldIterate && hintResult.hint) {
              await ctx.log("INFO", "GENERATE",
                `Retry hint generated (${hintResult.hint.length}ch). Starting iteration ${iteration + 1}...`);
              previousFeedback = hintResult.hint;
              iteration++;
            } else {
              break;
            }
          } catch (verifyErr) {
            // Verifier/hint failure — use what we have
            await ctx.log("WARN", "GENERATE",
              `Verification failed: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}. Using current build.`);
            if (!bestResult) bestResult = result;
            break;
          }
        }

        if (!bestResult) {
          throw new Error("No successful build across all iterations");
        }

        return bestResult;
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
    return NextResponse.json(
      { error: "worker error", detail: msg.slice(0, 500) },
      { status: 500 },
    );
  }
}
