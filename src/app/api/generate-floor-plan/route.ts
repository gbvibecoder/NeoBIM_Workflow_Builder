/**
 * POST /api/generate-floor-plan
 *
 * Standalone floor plan generation from a text prompt.
 * Uses the 3-STAGE AI PIPELINE:
 *
 * Stage 1: AI Room Programming (GPT-4o-mini) — prompt → structured rooms with adjacency/zones
 * Stage 2: AI Spatial Layout (GPT-4o) — rooms → positioned layout with validation + retry
 * Stage 3: Architectural Detailing (code) — geometry → FloorPlanProject (walls, doors, windows)
 */

export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit, isAdminUser } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { generateFloorPlan } from "@/features/ai/services/openai";
import { logger } from "@/lib/logger";
import {
  programRooms,
  programRoomsFallback,
  programToDescription,
  extractMentionedRooms,
} from "@/features/floor-plan/lib/ai-room-programmer";
import type { EnhancedRoomProgram } from "@/features/floor-plan/lib/ai-room-programmer";
import {
  convertGeometryToProject,
  convertMultiFloorToProject,
  buildGeometryFromGrid,
  convertGridToProject,
  convertGridFloorCoordinationToProject,
} from "@/features/floor-plan/lib/pipeline-adapter";
import { layoutFloorPlan, layoutMultiFloor, scoreAdjacency } from "@/features/floor-plan/lib/layout-engine";
import { computeGridFromRooms, mapBSPRoomsToGridCells } from "@/features/floor-plan/lib/snap-to-grid";
import type { FloorPlanGeometry } from "@/features/floor-plan/types/floor-plan";
import type { FloorPlanProject } from "@/types/floor-plan-cad";

// Grid-first pipeline imports
import { generateStructuralGrid, optimizeBayDimensions } from "@/features/floor-plan/lib/grid-generator";
import { assignRoomsToGrid } from "@/features/floor-plan/lib/grid-room-assigner";
import { generateWallsFromGrid } from "@/features/floor-plan/lib/grid-wall-generator";
import {
  validateGrid,
  validateRoomAssignment,
  validateWallSystem,
  validateOpenings,
  validateFinal,
  shouldRetry,
  type ValidationFixAction,
} from "@/features/floor-plan/lib/generation-validator";
import { coordinateFloors } from "@/features/floor-plan/lib/multi-floor-coordinator";
import { checkDesignQuality, type DesignFix } from "@/features/floor-plan/lib/design-quality-checker";
import { validateInterpretation } from "@/features/floor-plan/lib/ai-room-programmer";

// Template + Optimizer pipeline imports
import { matchTypology } from "@/features/floor-plan/lib/typology-matcher";
import { optimizeLayout } from "@/features/floor-plan/lib/layout-optimizer";
import type { PlacedRoom as OptimizerPlacedRoom } from "@/features/floor-plan/lib/energy-function";
import { getRoomRule } from "@/features/floor-plan/lib/architectural-rules";
import { classifyRoom } from "@/features/floor-plan/lib/room-sizer";

// Pipeline B (CSP / parser-driven) imports — Day 3 skeleton
import { routePrompt } from "@/features/floor-plan/lib/pipeline-router";
import { runPipelineB } from "@/features/floor-plan/lib/pipeline-b-orchestrator";

// Phase 1 — post-solve honest metrics (pipeline-agnostic)
import { computeLayoutMetrics, computeHonestScore } from "@/features/floor-plan/lib/layout-metrics";

// Phase 3 — strip-pack engine (PIPELINE_T1 feature flag)
import { runStripPackEngine, fillDoorMetrics } from "@/features/floor-plan/lib/strip-pack/strip-pack-engine";
import { toFloorPlanProject as toFloorPlanProjectT1 } from "@/features/floor-plan/lib/strip-pack/converter";
import { parseConstraints } from "@/features/floor-plan/lib/structured-parser";

// Phase 3H — LLM layout engine (PIPELINE_LLM feature flag)
import { runLLMLayoutEngine } from "@/features/floor-plan/lib/llm-layout-engine";

// Phase 5 — Grid-Pack engine (PIPELINE_GRID feature flag)
import { runGridPackEngine } from "@/features/floor-plan/lib/grid-pack-engine";

// Phase 6 — Reference + Adapt engine (PIPELINE_REF feature flag)
import { runReferenceEngine } from "@/features/floor-plan/lib/dynamic-reference-engine";

// ── Generation Feedback ────────────────────────────────────────────────────

interface GenerationFeedback {
  title: string;
  area_sqm: number;
  floors: Array<{ level: number; name: string; rooms: string[] }>;
  room_count: number;
  wall_count: number;
  door_count: number;
  window_count: number;
  furniture_count: number;
  has_staircase: boolean;
  adjacency_score?: { total: number; satisfied: number; percentage: number; unsatisfied: string[] };
  tips: string[];
}

function buildFeedback(project: FloorPlanProject, prompt: string): GenerationFeedback {
  const floors = project.floors.map(f => ({
    level: f.level,
    name: f.name,
    rooms: f.rooms.map(r => r.name),
  }));

  const roomCount = project.floors.reduce((s, f) => s + f.rooms.length, 0);
  const wallCount = project.floors.reduce((s, f) => s + f.walls.length, 0);
  const doorCount = project.floors.reduce((s, f) => s + f.doors.length, 0);
  const windowCount = project.floors.reduce((s, f) => s + f.windows.length, 0);
  const furnitureCount = project.floors.reduce((s, f) => s + f.furniture.length, 0);
  const hasStaircase = project.floors.some(f => f.stairs.length > 0);

  const tips: string[] = [];
  tips.push("Click any room to edit. Drag walls to resize.");
  if (project.floors.length > 1) {
    tips.push("Use the floor selector to switch between levels.");
  }
  if (hasStaircase) {
    tips.push("Staircase is vertically aligned across floors.");
  }
  if (furnitureCount > 0) {
    tips.push(`${furnitureCount} furniture items auto-placed. Drag to rearrange.`);
  }

  return {
    title: project.name,
    area_sqm: project.metadata.carpet_area_sqm ?? 0,
    floors,
    room_count: roomCount,
    wall_count: wallCount,
    door_count: doorCount,
    window_count: windowCount,
    furniture_count: furnitureCount,
    has_staircase: hasStaircase,
    tips,
  };
}

/** Pre-flight feasibility check — catches impossible prompts before spending on GPT-4o calls. */
function checkPromptFeasibility(parsed: import("@/features/floor-plan/lib/structured-parser").ParsedConstraints): { feasible: boolean; reason?: string } {
  const plotW = parsed.plot.width_ft ?? 40;
  const plotD = parsed.plot.depth_ft ?? 50;
  const plotArea = plotW * plotD;
  const nonCircRooms = parsed.rooms.filter(r => !r.is_circulation);
  const roomCount = nonCircRooms.length;

  // Sum of requested room areas
  const roomArea = nonCircRooms.reduce((s, r) => {
    const w = r.dim_width_ft ?? 10;
    const d = r.dim_depth_ft ?? 8;
    return s + w * d;
  }, 0);

  // Rooms take more than 130% of plot — impossible
  if (roomArea > plotArea * 1.3) {
    return {
      feasible: false,
      reason: `Your rooms total ~${Math.round(roomArea)} sqft but your plot is only ${Math.round(plotArea)} sqft. Reduce room sizes or use a larger plot.`,
    };
  }

  // Plot too small for the number of rooms (minimum 25sqft per room = 5x5ft)
  if (plotArea < roomCount * 25) {
    return {
      feasible: false,
      reason: `${roomCount} rooms need at least ${roomCount * 25} sqft but your plot is only ${Math.round(plotArea)} sqft. Use a larger plot or fewer rooms.`,
    };
  }

  return { feasible: true };
}

/** Record a standalone tool use as an Execution so it shows in dashboard + admin.
 *  Uses a per-user workflow named "__standalone_tools__" (hidden from My Workflows
 *  by name filter). Must have deletedAt = null so billing/executions APIs include it. */
async function recordToolExecution(userId: string, toolName: string) {
  try {
    // Find a non-deleted tracking workflow
    let wf = await prisma.workflow.findFirst({
      where: { ownerId: userId, name: "__standalone_tools__", deletedAt: null },
      select: { id: true },
    });
    if (!wf) {
      // Fix legacy: un-delete any soft-deleted one from earlier code
      const legacy = await prisma.workflow.findFirst({
        where: { ownerId: userId, name: "__standalone_tools__" },
        select: { id: true },
      });
      if (legacy) {
        wf = await prisma.workflow.update({
          where: { id: legacy.id },
          data: { deletedAt: null },
          select: { id: true },
        });
      } else {
        wf = await prisma.workflow.create({
          data: {
            ownerId: userId,
            name: "__standalone_tools__",
            description: "Auto-created for standalone tool usage tracking",
          },
          select: { id: true },
        });
      }
    }
    await prisma.execution.create({
      data: {
        workflowId: wf.id,
        userId,
        status: "SUCCESS",
        startedAt: new Date(),
        completedAt: new Date(),
        tileResults: [],
        metadata: { tool: toolName },
      },
    });
    console.log(`[recordToolExecution] Recorded ${toolName} for user ${userId}`);
  } catch (err) {
    console.error("[recordToolExecution] Failed:", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    // ── Auth ──
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const userRole = ((session.user as { role?: string }).role) || "FREE";
    const userEmail = session.user.email || "";
    const isAdmin = isAdminUser(userEmail) || userRole === "PLATFORM_ADMIN" || userRole === "TEAM_ADMIN";

    // ── Rate limit: 5 floor plan generations per minute ──
    if (!isAdmin) {
      const rl = await checkEndpointRateLimit(userId, "generate-floor-plan", 5, "1 m");
      if (!rl.success) {
        return NextResponse.json(
          { error: "Too many floor plan requests. Please wait a moment." },
          { status: 429 }
        );
      }
    }

    // ── FREE tier: 3 lifetime executions (2 unverified + 1 after verification) ──
    if (!isAdmin && userRole === "FREE") {
      const lifetimeCompleted = await prisma.execution.count({
        where: { userId, status: { in: ["SUCCESS", "PARTIAL"] } },
      });

      // Hard cap: 3 lifetime executions
      if (lifetimeCompleted >= 3) {
        return NextResponse.json(
          { error: "PLAN_LIMIT", title: "Free executions used", message: "You've used all 3 free executions. Upgrade to keep building amazing floor plans!", action: "View Plans", actionUrl: "/dashboard/billing" },
          { status: 429 }
        );
      }

      // Verification gate: after 2, must verify email for the last one
      let isEmailVerified = !!(session.user as { emailVerified?: boolean }).emailVerified;
      if (!isEmailVerified) {
        const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } });
        isEmailVerified = !!dbUser?.emailVerified;
      }
      if (!isEmailVerified && lifetimeCompleted >= 2) {
        return NextResponse.json(
          { error: "EMAIL_VERIFY", title: "Verify your email", message: "You've used 2 of your 3 free executions. Verify your email to unlock your final free floor plan!", action: "Verify Email", actionUrl: "/dashboard/settings" },
          { status: 403 }
        );
      }
    }

    const body = await req.json();
    const prompt = body.prompt as string;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "NO_API_KEY" }, { status: 503 });
    }

    // ── Pipeline Router (Day 3 — Pipeline B skeleton) ────────────────
    // Routes high-constraint prompts (>=5 explicit signals) to the new
    // structured-parser + CSP pipeline. Vague prompts continue to use
    // the existing template+SA Pipeline A unchanged.
    const routing = routePrompt(prompt);
    logger.debug(`[ROUTER] pipeline=${routing.pipeline} signals=${routing.constraint_signals}`);

    // ── Phase 6 — Reference + Adapt Engine (PIPELINE_REF) ──────────────
    // THE FINAL ENGINE. Combines ALL learnings from 16 previous approaches:
    // - GPT-4o generates using real reference plans as few-shot examples
    // - Normalized (0-1) coords scale perfectly to any plot size
    // - Strict validation catches bad output BEFORE it reaches the user
    // - Retry with error feedback recovers most failures
    // - Static reference fallback guarantees output for 100% of prompts
    // Runs for ALL prompts (no routing gate).
    if (process.env.PIPELINE_REF === "true") {
      try {
        const refStart = Date.now();
        const refParseRes = await parseConstraints(prompt, apiKey);
        const refParseMs = Date.now() - refStart;

        const feasibility = checkPromptFeasibility(refParseRes.constraints);
        if (!feasibility.feasible) {
          return NextResponse.json({
            error: feasibility.reason,
            infeasibilityReason: feasibility.reason,
          }, { status: 422 });
        }

        const refEngineStart = Date.now();
        const result = await runReferenceEngine(prompt, refParseRes.constraints, apiKey);
        const refEngineMs = Date.now() - refEngineStart;

        const project = toFloorPlanProjectT1(result, refParseRes.constraints);
        const layoutMetrics = computeLayoutMetrics(project, refParseRes.constraints);
        const score = computeHonestScore(layoutMetrics);

        logger.debug(`[REF-ENGINE] parse=${refParseMs}ms engine=${refEngineMs}ms eff=${result.metrics.efficiency_pct}% score=${score.score}`);
        console.log(`[REF-ENGINE] ${result.rooms.length} rooms, ${result.walls.length} walls, ${result.doors.length} doors, score=${score.score}/100`);

        const feedback = buildFeedback(project, prompt);
        feedback.tips.push(`Reference Engine: ${result.metrics.efficiency_pct}% efficiency, honest score ${score.score}/100`);
        await recordToolExecution(userId, "floor-plan");

        return NextResponse.json({
          project,
          geometry: null,
          feedback,
          pipeline: "reference-engine",
          pipeline_timing: {
            parse_ms: refParseMs,
            engine_ms: refEngineMs,
            total_ms: Date.now() - refStart,
          },
          score,
          warnings: result.warnings,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[REF-ENGINE] error — falling through: ${msg}`);
      }
    }

    // ── Phase 5 — Grid-Pack Engine (PIPELINE_GRID) ─────────────────────
    // LLM decides row grouping, algorithm computes exact coordinates.
    // Zero floating rooms, zero gaps BY CONSTRUCTION.
    if (process.env.PIPELINE_GRID === "true" && routing.pipeline === "B") {
      try {
        const gpStart = Date.now();
        const gpParseRes = await parseConstraints(prompt, apiKey);
        const gpParseMs = Date.now() - gpStart;

        const feasibility = checkPromptFeasibility(gpParseRes.constraints);
        if (!feasibility.feasible) {
          console.warn(`[GRID-PACK][INFEASIBILITY] ${feasibility.reason}`);
          return NextResponse.json({
            error: feasibility.reason,
            infeasibilityReason: feasibility.reason,
          }, { status: 422 });
        }

        const gpEngineStart = Date.now();
        const gpResult = await runGridPackEngine(prompt, gpParseRes.constraints, apiKey);
        const gpEngineMs = Date.now() - gpEngineStart;

        const gpProject = toFloorPlanProjectT1(gpResult, gpParseRes.constraints);
        const gpLayoutMetrics = computeLayoutMetrics(gpProject, gpParseRes.constraints);
        const gpScore = computeHonestScore(gpLayoutMetrics);

        logger.debug(`[GRID-PACK] parse=${gpParseMs}ms engine=${gpEngineMs}ms eff=${gpResult.metrics.efficiency_pct}% doors=${gpResult.metrics.door_coverage_pct}% score=${gpScore.score}`);
        console.log(`[GRID-PACK] Rooms: ${gpResult.rooms.filter(r => r.placed).length}/${gpParseRes.constraints.rooms.length}, warnings: ${gpResult.warnings.length}`);

        const feedback = buildFeedback(gpProject, prompt);
        feedback.tips.push(`Grid-Pack engine: score ${gpScore.score}/100, ${gpResult.metrics.efficiency_pct}% efficiency`);
        await recordToolExecution(userId, "floor-plan");

        return NextResponse.json({
          project: gpProject,
          geometry: null,
          feedback,
          pipeline: "grid-pack",
          pipeline_timing: {
            parse_ms: gpParseMs,
            engine_ms: gpEngineMs,
            total_ms: Date.now() - gpStart,
          },
          score: gpScore,
          warnings: gpResult.warnings,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[GRID-PACK] error — falling through to LLM/T1: ${msg}`);
      }
    }

    // ── Phase 4 — Multi-Option LLM Layout Engine ("Midjourney approach") ─
    // Generate 3 options in parallel with temperature diversity.
    // Score them all, return the best. Non-determinism becomes a feature.
    // Math: if P(good) = 70%, then P(≥1 good in 3) = 1 - 0.3³ = 97.3%.
    if (process.env.PIPELINE_LLM === "true" && routing.pipeline === "B") {
      try {
        const llmStart = Date.now();
        const llmParseRes = await parseConstraints(prompt, apiKey);
        const llmParseMs = Date.now() - llmStart;

        // Infeasibility guard — catch impossible prompts before spending on GPT-4o
        const feasibility = checkPromptFeasibility(llmParseRes.constraints);
        if (!feasibility.feasible) {
          console.warn(`[INFEASIBILITY] ${feasibility.reason}`);
          return NextResponse.json({
            error: feasibility.reason,
            infeasibilityReason: feasibility.reason,
            pipelineUsed: "LLM-multi-option",
            routerSignals: routing.constraint_signals,
          }, { status: 422 });
        }

        // Generate 3 options in parallel with different temperatures
        const NUM_OPTIONS = 3;
        const temperatures = [0.2, 0.4, 0.6];
        const llmEngineStart = Date.now();

        const optionPromises = Array.from({ length: NUM_OPTIONS }, (_, i) => {
          const temp = temperatures[i % temperatures.length];
          const optStart = Date.now();
          return runLLMLayoutEngine(prompt, llmParseRes.constraints, apiKey, { temperature: temp, variant: i })
            .then(result => {
              console.log(`[OPTION-${i}] done in ${Date.now() - optStart}ms (temp=${temp})`);
              return { result, index: i, temp };
            })
            .catch(err => {
              console.warn(`[OPTION-${i}] failed (temp=${temp}): ${err instanceof Error ? err.message : String(err)}`);
              return null;
            });
        });

        const rawOptions = await Promise.all(optionPromises);
        const llmEngineMs = Date.now() - llmEngineStart;

        // Filter out failures, score each, sort by honest score
        const scoredOptions = rawOptions
          .filter((opt): opt is NonNullable<typeof opt> => opt !== null)
          .map(opt => {
            const filled = fillDoorMetrics(opt.result);
            const project = toFloorPlanProjectT1(filled, llmParseRes.constraints);
            const metrics = computeLayoutMetrics(project, llmParseRes.constraints);
            const score = computeHonestScore(metrics);
            return { ...opt, result: filled, project, metrics, score };
          })
          .sort((a, b) => {
            // Primary: honest score (higher wins)
            if (b.score.score !== a.score.score) return b.score.score - a.score.score;
            // Tiebreaker 1: fewer orphans wins (orphans = worst defect)
            if (a.metrics.orphan_rooms.length !== b.metrics.orphan_rooms.length)
              return a.metrics.orphan_rooms.length - b.metrics.orphan_rooms.length;
            // Tiebreaker 2: higher door coverage wins
            if (b.metrics.door_coverage_pct !== a.metrics.door_coverage_pct)
              return b.metrics.door_coverage_pct - a.metrics.door_coverage_pct;
            // Tiebreaker 3: higher efficiency wins
            return b.metrics.efficiency_pct - a.metrics.efficiency_pct;
          });

        console.log(`[OPTIONS] Generated ${scoredOptions.length}/${NUM_OPTIONS} options in ${llmEngineMs}ms (parse=${llmParseMs}ms):`);
        for (const opt of scoredOptions) {
          console.log(
            `  Option-${opt.index} (temp=${opt.temp}): score=${opt.score.score}/100 (${opt.score.grade}) ` +
            `doors=${opt.metrics.door_coverage_pct}% orphans=${opt.metrics.orphan_rooms.length} ` +
            `eff=${opt.metrics.efficiency_pct}% rooms=${opt.result.rooms.length}`,
          );
        }

        if (scoredOptions.length > 0) {
          const best = scoredOptions[0];

          // Accept if best option meets minimum quality bar
          if (best.score.score >= 45 && best.metrics.orphan_rooms.length <= 3) {
            console.log(`[OPTIONS] ACCEPTED best: Option-${best.index} score=${best.score.score}/100 (${best.score.grade})`);
            const feedback = buildFeedback(best.project, prompt);
            feedback.tips.push(
              `LLM multi-option: best of ${scoredOptions.length} (Option-${best.index}, temp=${best.temp}), ` +
              `${best.result.rooms.length} rooms, ${best.result.doors.length} doors, ` +
              `${best.metrics.efficiency_pct}% efficiency in ${llmParseMs + llmEngineMs}ms`,
            );
            if (scoredOptions.length > 1) {
              const worst = scoredOptions[scoredOptions.length - 1];
              feedback.tips.push(
                `Score range: ${worst.score.score}–${best.score.score} (Δ${best.score.score - worst.score.score})`,
              );
            }
            await recordToolExecution(userId, "floor-plan");
            return NextResponse.json({
              // Best option (backward compatible — existing UI shows this)
              project: best.project,
              geometry: null,
              svg: null,
              feedback,
              layoutMetrics: best.metrics,
              qualityFlags: best.metrics.quality_flags,
              feasibilityWarnings: [],
              pipelineUsed: "LLM-multi-option",
              relaxationsApplied: best.result.warnings,
              infeasibilityReason: null,
              mandalaAssignments: null,
              routerSignals: routing.constraint_signals,
              honestScore: best.score,

              // ALL options for future option picker UI (Phase 2)
              options: scoredOptions.map((opt, i) => ({
                index: i,
                project: opt.project,
                score: opt.score.score,
                grade: opt.score.grade,
                efficiency: opt.metrics.efficiency_pct,
                doorCoverage: opt.metrics.door_coverage_pct,
                orphanCount: opt.metrics.orphan_rooms.length,
                voidArea: opt.metrics.void_area_sqft,
                roomCount: opt.project.floors[0]?.rooms.length ?? 0,
              })),
            });
          }

          // Score too low for auto-accept — but still ship if T1/B also
          // won't produce anything better (the downstream race will compare).
          // Log and fall through.
          console.warn(`[OPTIONS] Best score ${best.score.score} below threshold — falling through to T1/B`);
        } else {
          console.warn(`[OPTIONS] All ${NUM_OPTIONS} options failed — falling through to T1/B`);
        }

        // Emergency fallback: if T1/B is disabled and we DO have a scored
        // option (even a bad one), ship it rather than returning nothing.
        if (
          scoredOptions.length > 0 &&
          process.env.PIPELINE_T1 !== "true" &&
          scoredOptions[0].score.score > 0
        ) {
          const emergency = scoredOptions[0];
          console.warn(`[OPTIONS] Emergency ship: score=${emergency.score.score} (no T1/B fallback available)`);
          const feedback = buildFeedback(emergency.project, prompt);
          feedback.tips.push(`Emergency fallback: score ${emergency.score.score}/100 — below target but best available`);
          await recordToolExecution(userId, "floor-plan");
          return NextResponse.json({
            project: emergency.project,
            geometry: null,
            svg: null,
            feedback,
            layoutMetrics: emergency.metrics,
            qualityFlags: emergency.metrics.quality_flags,
            feasibilityWarnings: [],
            pipelineUsed: "LLM-multi-option-emergency",
            relaxationsApplied: emergency.result.warnings,
            infeasibilityReason: null,
            mandalaAssignments: null,
            routerSignals: routing.constraint_signals,
            honestScore: emergency.score,
            options: scoredOptions.map((opt, i) => ({
              index: i,
              project: opt.project,
              score: opt.score.score,
              grade: opt.score.grade,
              efficiency: opt.metrics.efficiency_pct,
              doorCoverage: opt.metrics.door_coverage_pct,
              orphanCount: opt.metrics.orphan_rooms.length,
              voidArea: opt.metrics.void_area_sqft,
              roomCount: opt.project.floors[0]?.rooms.length ?? 0,
            })),
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[LLM-MULTI] error — falling through to T1/B: ${msg}`);
      }
    }

    // ── Phase 3 — Strip-Pack Engine (PIPELINE_T1) ────────────────────────
    // Strategy (Phase 3G — race & compare):
    //   1. Run T1. If it clearly wins the fast gates, ship it immediately —
    //      no point paying for Pipeline B.
    //   2. If T1 doesn't hit the fast gates (or throws), log EXACTLY which
    //      metric missed, then ALSO run Pipeline B.
    //   3. Compare both outputs by honest score (void + door coverage +
    //      orphans + adjacency + dim deviation — the same scoring function
    //      the UI uses). Return whichever scores higher. Fall back to 422
    //      only when neither pipeline produced a project.
    type T1Bundle = {
      result: Awaited<ReturnType<typeof fillDoorMetrics>>;
      project: ReturnType<typeof toFloorPlanProjectT1>;
      layoutMetrics: ReturnType<typeof computeLayoutMetrics>;
      score: ReturnType<typeof computeHonestScore>;
      parseRes: Awaited<ReturnType<typeof parseConstraints>>;
      parseMs: number;
      engineMs: number;
      passesFastGates: boolean;
    };

    let t1Bundle: T1Bundle | null = null;
    let t1Error: string | null = null;

    if (process.env.PIPELINE_T1 === "true" && routing.pipeline === "B") {
      try {
        const t1Start = Date.now();
        const parseRes = await parseConstraints(prompt, apiKey);
        const t1ParseMs = Date.now() - t1Start;
        const engineStart = Date.now();
        const rawResult = await runStripPackEngine(parseRes.constraints, prompt);
        const t1Result = fillDoorMetrics(rawResult);
        const t1EngineMs = Date.now() - engineStart;

        const t1Project = toFloorPlanProjectT1(t1Result, parseRes.constraints);
        const t1LayoutMetrics = computeLayoutMetrics(t1Project, parseRes.constraints);
        const t1Score = computeHonestScore(t1LayoutMetrics);

        const roomsPlaced = t1Result.rooms.filter(r => r.placed).length;
        const roomsExpected = parseRes.constraints.rooms?.length ?? 0;
        const roomCoverage = roomsExpected > 0 ? roomsPlaced / roomsExpected : 1;
        const gateEff      = t1Result.metrics.efficiency_pct      >= 55;
        const gateDoors    = t1Result.metrics.door_coverage_pct   >= 70;
        const gateCoverage = roomCoverage                          >= 0.90;
        const passesFastGates = gateEff && gateDoors && gateCoverage;

        logger.debug(`[T1] parse=${t1ParseMs}ms engine=${t1EngineMs}ms eff=${t1Result.metrics.efficiency_pct}% doors=${t1Result.metrics.door_coverage_pct}% rooms=${roomsPlaced}/${roomsExpected}`);
        console.log(
          `[T1] metrics: eff=${t1Result.metrics.efficiency_pct}% (gate>=55 ${gateEff ? "✓" : "✗"}), ` +
          `doors=${t1Result.metrics.door_coverage_pct}% (>=70 ${gateDoors ? "✓" : "✗"}), ` +
          `coverage=${roomsPlaced}/${roomsExpected} (${Math.round(roomCoverage * 100)}%, >=90 ${gateCoverage ? "✓" : "✗"}), ` +
          `ui-orphans=${t1LayoutMetrics.orphan_rooms.length}, honest=${t1Score.score}/100 (${t1Score.grade})`,
        );
        if (!passesFastGates) {
          const missed: string[] = [];
          if (!gateEff)      missed.push(`eff ${t1Result.metrics.efficiency_pct}% < 55%`);
          if (!gateDoors)    missed.push(`doors ${t1Result.metrics.door_coverage_pct}% < 70%`);
          if (!gateCoverage) missed.push(`coverage ${roomsPlaced}/${roomsExpected} < 90%`);
          console.warn(`[T1] fast-gate miss: ${missed.join("; ")} — racing Pipeline B`);
        }

        t1Bundle = {
          result: t1Result,
          project: t1Project,
          layoutMetrics: t1LayoutMetrics,
          score: t1Score,
          parseRes,
          parseMs: t1ParseMs,
          engineMs: t1EngineMs,
          passesFastGates,
        };
      } catch (err) {
        t1Error = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : String(err);
        console.warn(`[T1] engine error — falling back to Pipeline B only: ${t1Error}\n${stack ?? ""}`);
      }

      // Fast path — T1 clearly passes gates, no need to pay for Pipeline B.
      if (t1Bundle && t1Bundle.passesFastGates) {
        console.log(
          `[T1] ACCEPTED via fast gates: honest=${t1Bundle.score.score}/100 (${t1Bundle.score.grade}), ` +
          `orphans=${t1Bundle.layoutMetrics.orphan_rooms.length}`,
        );
        const { result: t1Result, project, layoutMetrics, parseMs, engineMs } = t1Bundle;
        const feedback = buildFeedback(project, prompt);
        feedback.tips.push(`T1 strip-pack: ${t1Result.rooms.length} rooms, ${t1Result.doors.length} doors, ${t1Result.metrics.efficiency_pct}% efficiency in ${parseMs + engineMs}ms`);
        if (t1Result.warnings.length > 0) {
          feedback.tips.push(`T1 warnings: ${t1Result.warnings.slice(0, 3).join("; ")}${t1Result.warnings.length > 3 ? "…" : ""}`);
        }
        await recordToolExecution(userId, "floor-plan");
        return NextResponse.json({
          project,
          geometry: null,
          svg: null,
          feedback,
          layoutMetrics,
          qualityFlags: layoutMetrics.quality_flags,
          feasibilityWarnings: [],
          pipelineUsed: "T1-strip-pack",
          relaxationsApplied: t1Result.warnings,
          infeasibilityReason: null,
          mandalaAssignments: null,
          routerSignals: routing.constraint_signals,
          honestScore: t1Bundle.score,
        });
      }

      // Race path — either T1 failed gates or errored. Run Pipeline B and
      // compare honest scores.
      console.log(`[SCOREBOARD] T1 ${t1Bundle ? "below fast gates" : "errored"} — running Pipeline B for head-to-head`);
      const bResult = await runPipelineB(prompt, apiKey);
      logger.debug(`[PIPELINE-B] ${bResult.pipelineUsed} parse=${bResult.timings.parse_ms}ms total=${bResult.timings.total_ms}ms`);

      const bLayoutMetrics = bResult.project
        ? computeLayoutMetrics(bResult.project, bResult.parsedConstraints ?? undefined)
        : null;
      const bScore = bLayoutMetrics ? computeHonestScore(bLayoutMetrics) : null;

      // Log the scoreboard for both candidates.
      const t1Summary = t1Bundle
        ? `T1: score=${t1Bundle.score.score}/100 (${t1Bundle.score.grade}) orphans=${t1Bundle.layoutMetrics.orphan_rooms.length} doors=${t1Bundle.result.doors.length} eff=${t1Bundle.layoutMetrics.efficiency_pct}%`
        : `T1: ERROR (${t1Error})`;
      const bSummary = bScore && bLayoutMetrics && bResult.project
        ? `B:  score=${bScore.score}/100 (${bScore.grade}) orphans=${bLayoutMetrics.orphan_rooms.length} doors=${bResult.project.floors[0]?.doors.length ?? 0} eff=${bLayoutMetrics.efficiency_pct}%`
        : `B:  INFEASIBLE (${bResult.infeasibilityReason ?? bResult.error ?? "no project"})`;
      console.log(`[SCOREBOARD] ${t1Summary}`);
      console.log(`[SCOREBOARD] ${bSummary}`);

      // Decide the winner. Prefer higher honest score; tie goes to T1 (fewer
      // warning-grade orphans by construction, and parser work is already
      // amortized). Fall back to whichever side produced a project at all.
      const useT1 = (() => {
        if (t1Bundle && bScore) return t1Bundle.score.score >= bScore.score;
        if (t1Bundle) return true;
        return false;
      })();

      if (useT1 && t1Bundle) {
        const bScoreStr = bScore ? `${bScore.score}` : "n/a";
        console.log(`[SCOREBOARD] WINNER=T1 (honest ${t1Bundle.score.score} vs B ${bScoreStr})`);
        const { result: t1Result, project, layoutMetrics, parseMs, engineMs } = t1Bundle;
        const feedback = buildFeedback(project, prompt);
        feedback.tips.push(`T1 strip-pack (score ${t1Bundle.score.score}/100, grade ${t1Bundle.score.grade}): ${t1Result.rooms.length} rooms, ${t1Result.doors.length} doors, ${t1Result.metrics.efficiency_pct}% efficiency in ${parseMs + engineMs}ms`);
        feedback.tips.push(`Beat Pipeline B ${bScoreStr}/100 on honest score`);
        if (t1Result.warnings.length > 0) {
          feedback.tips.push(`T1 warnings: ${t1Result.warnings.slice(0, 3).join("; ")}${t1Result.warnings.length > 3 ? "…" : ""}`);
        }
        await recordToolExecution(userId, "floor-plan");
        return NextResponse.json({
          project,
          geometry: null,
          svg: null,
          feedback,
          layoutMetrics,
          qualityFlags: layoutMetrics.quality_flags,
          feasibilityWarnings: [],
          pipelineUsed: "T1-strip-pack",
          relaxationsApplied: t1Result.warnings,
          infeasibilityReason: null,
          mandalaAssignments: null,
          routerSignals: routing.constraint_signals,
          honestScore: t1Bundle.score,
        });
      }

      if (bResult.project && bLayoutMetrics && bScore) {
        console.log(`[SCOREBOARD] WINNER=B (honest ${bScore.score} vs T1 ${t1Bundle ? t1Bundle.score.score : "err"})`);
        const feedback = buildFeedback(bResult.project, prompt);
        const summary = bResult.pipelineUsed === "B-fine"
          ? `Pipeline B (3A+3B fine): ${bResult.constraintsExtracted} rooms, mandala=${bResult.timings.csp_3a_ms}ms, fine=${bResult.timings.csp_3b_ms}ms`
          : bResult.pipelineUsed === "B-mandala"
          ? `Pipeline B (3A mandala only): ${bResult.constraintsExtracted} rooms, mandala=${bResult.timings.csp_3a_ms}ms`
          : `Pipeline B (${bResult.pipelineUsed}): ${bResult.constraintsExtracted} rooms in ${bResult.timings.total_ms}ms`;
        feedback.tips.push(`${summary} — score ${bScore.score}/100 (${bScore.grade})`);
        feedback.tips.push(`Beat T1 strip-pack ${t1Bundle ? `${t1Bundle.score.score}/100` : "error"} on honest score`);
        if (bResult.relaxationsApplied.length > 0) {
          feedback.tips.push(`Relaxations: ${bResult.relaxationsApplied.join("; ")}`);
        }
        await recordToolExecution(userId, "floor-plan");
        return NextResponse.json({
          project: bResult.project,
          geometry: null,
          svg: null,
          feedback,
          layoutMetrics: bLayoutMetrics,
          qualityFlags: bLayoutMetrics.quality_flags,
          feasibilityWarnings: bResult.feasibilityWarnings,
          pipelineUsed: bResult.pipelineUsed,
          relaxationsApplied: bResult.relaxationsApplied,
          infeasibilityReason: null,
          mandalaAssignments: bResult.mandalaAssignments,
          routerSignals: routing.constraint_signals,
          honestScore: bScore,
        });
      }

      // Neither produced a project — 422.
      console.warn(`[SCOREBOARD] BOTH PIPELINES INFEASIBLE (T1 err: ${t1Error ?? "n/a"}; B: ${bResult.infeasibilityReason ?? bResult.error ?? "no project"})`);
      return NextResponse.json({
        error: bResult.infeasibilityReason ?? bResult.error ?? t1Error ?? "Both pipelines failed",
        pipelineUsed: bResult.pipelineUsed,
        relaxationsApplied: bResult.relaxationsApplied,
        feasibilityWarnings: bResult.feasibilityWarnings,
        infeasibilityReason: bResult.infeasibilityReason,
        infeasibilityKind: bResult.infeasibilityKind,
        cspConflict: bResult.cspConflict,
        cspRuleIds: bResult.cspRuleIds,
        routerSignals: routing.constraint_signals,
      }, { status: 422 });
    }

    if (routing.pipeline === "B") {
      const bResult = await runPipelineB(prompt, apiKey);
      logger.debug(`[PIPELINE-B] ${bResult.pipelineUsed} parse=${bResult.timings.parse_ms}ms detector=${bResult.timings.detector_ms}ms placement=${bResult.timings.placement_ms}ms total=${bResult.timings.total_ms}ms`);
      await recordToolExecution(userId, "floor-plan");
      if (bResult.project) {
        const feedback = buildFeedback(bResult.project, prompt);
        const summary = bResult.pipelineUsed === "B-fine"
          ? `Pipeline B (3A+3B fine): ${bResult.constraintsExtracted} rooms, mandala=${bResult.timings.csp_3a_ms}ms, fine=${bResult.timings.csp_3b_ms}ms`
          : bResult.pipelineUsed === "B-mandala"
          ? `Pipeline B (3A mandala only): ${bResult.constraintsExtracted} rooms, mandala=${bResult.timings.csp_3a_ms}ms`
          : `Pipeline B (${bResult.pipelineUsed}): ${bResult.constraintsExtracted} rooms in ${bResult.timings.total_ms}ms`;
        feedback.tips.push(summary);
        if (bResult.relaxationsApplied.length > 0) {
          feedback.tips.push(`Relaxations: ${bResult.relaxationsApplied.join("; ")}`);
        }
        const layoutMetrics = computeLayoutMetrics(
          bResult.project,
          bResult.parsedConstraints ?? undefined,
        );
        return NextResponse.json({
          project: bResult.project,
          geometry: null,
          svg: null,
          feedback,
          layoutMetrics,
          qualityFlags: layoutMetrics.quality_flags,
          feasibilityWarnings: bResult.feasibilityWarnings,
          pipelineUsed: bResult.pipelineUsed,
          relaxationsApplied: bResult.relaxationsApplied,
          infeasibilityReason: null,
          mandalaAssignments: bResult.mandalaAssignments,
          routerSignals: routing.constraint_signals,
        });
      }
      return NextResponse.json({
        error: bResult.infeasibilityReason ?? bResult.error ?? "Pipeline B failed",
        pipelineUsed: bResult.pipelineUsed,
        relaxationsApplied: bResult.relaxationsApplied,
        feasibilityWarnings: bResult.feasibilityWarnings,
        infeasibilityReason: bResult.infeasibilityReason,
        infeasibilityKind: bResult.infeasibilityKind,
        cspConflict: bResult.cspConflict,
        cspRuleIds: bResult.cspRuleIds,
        routerSignals: routing.constraint_signals,
      }, { status: 422 });
    }

    // ── Stage 1: AI Room Programming ──────────────────────────────────
    // Primary: AI parsing (GPT-4o-mini) with adjacency + zones
    // Fallback: regex parsing (offline, no API key needed)
    let roomProgram: EnhancedRoomProgram;
    let stage1Source = "ai";
    try {
      roomProgram = await programRooms(prompt, apiKey);
    } catch (parseErr) {
      stage1Source = "fallback";
      const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      const errStack = parseErr instanceof Error ? parseErr.stack?.split("\n").slice(0, 3).join(" | ") : "";
      console.error(`[STAGE-1] AI FAILED — using regex fallback. Error: ${errMsg}`);
      console.error(`[STAGE-1] Stack: ${errStack}`);
      roomProgram = programRoomsFallback(prompt);
    }

    // ── Stage 1 Diagnostic ──
    logger.debug(`[STAGE-1] Source: ${stage1Source}, Rooms: ${roomProgram.rooms.length}`, roomProgram.rooms.map(r => `${r.name} (floor:${r.floor ?? 0})`));

    // ── Prompt faithfulness check ──
    const mentionedRooms = extractMentionedRooms(prompt);
    const roomNamesLower = roomProgram.rooms.map(r => r.name.toLowerCase());
    const missingFromPrompt = mentionedRooms.filter(mentioned => {
      const ml = mentioned.toLowerCase();
      return !roomNamesLower.some(rn => rn.includes(ml) || ml.includes(rn) ||
        ml.split(/\s+/).some(w => w.length > 3 && rn.includes(w)));
    });
    if (missingFromPrompt.length > 0) {
      console.warn(`[FAITHFULNESS] ${missingFromPrompt.length} rooms from prompt not in output: ${missingFromPrompt.join(", ")}`);
    } else if (mentionedRooms.length > 0) {
      logger.debug(`[FAITHFULNESS] All ${mentionedRooms.length} mentioned rooms present in output`);
    }

    // ── Agent 1 Self-Check: validate interpretation ──
    const interpretation = validateInterpretation(roomProgram, prompt);
    logger.debug(`[AGENT-1] Confidence: ${(interpretation.confidence * 100).toFixed(0)}%, BHK match: ${interpretation.bedroomCountMatch}, fixes: ${interpretation.fixes.length}`);
    if (interpretation.fixes.length > 0) {
      logger.debug(`[AGENT-1] Applied fixes: ${interpretation.fixes.join('; ')}`);
    }

    // Convert to BuildingDescription for Stage 2
    const description = programToDescription(roomProgram);

    // ═══════════════════════════════════════════════════════════════════
    // MULTI-AGENT PIPELINE (primary path)
    // Agent 2 (Designer) + Agent 3 (Checker) in a feedback loop.
    // Falls back to BSP/AI pipeline on failure for backward compatibility.
    // ═══════════════════════════════════════════════════════════════════
    try {
      const gridResult = await runGridFirstPipeline(roomProgram, description.projectName, prompt);
      if (gridResult) {
        logger.debug('[GRID-FIRST] Pipeline succeeded — returning grid-based floor plan');
        await recordToolExecution(userId, "floor-plan");
        const layoutMetrics = computeLayoutMetrics(gridResult.project);
        return NextResponse.json({
          ...gridResult,
          layoutMetrics,
          qualityFlags: layoutMetrics.quality_flags,
        });
      }
      logger.debug('[GRID-FIRST] Pipeline returned null — falling back to BSP/AI pipeline');
    } catch (gridErr) {
      const msg = gridErr instanceof Error ? gridErr.message : String(gridErr);
      console.warn(`[GRID-FIRST] Pipeline failed — falling back to BSP/AI pipeline. Error: ${msg}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // LEGACY BSP/AI PIPELINE (fallback)
    // ═══════════════════════════════════════════════════════════════════

    // ── Multi-floor: BSP layout engine per floor (single path, no fallbacks) ──
    if (roomProgram.numFloors > 1) {
      logger.debug(`[MULTI-FLOOR] ★ BSP ONLY ★ ${roomProgram.numFloors} floors`);
      const multiFloor = layoutMultiFloor(roomProgram);

      // ── Stage 2 Diagnostic ──
      const totalPlaced = multiFloor.floors.reduce((s, f) => s + f.rooms.length, 0);
      logger.debug(`[STAGE-2] BSP multi-floor: ${totalPlaced} rooms`, multiFloor.floors.map(f => `Floor ${f.level}: ${f.rooms.length} rooms`));

      const project = convertMultiFloorToProject(
        multiFloor.floors, description.projectName, prompt,
      );

      // ── Stage 3 Diagnostic ──
      const projectRoomCount = project.floors.reduce((s, f) => s + f.rooms.length, 0);
      logger.debug(`[STAGE-3] Rooms in project: ${projectRoomCount}`, project.floors.map(f => `Floor ${f.level}: ${f.rooms.map(r => r.name).join(", ")}`));

      // Return ground floor geometry for backward-compatible rendering
      const gf = multiFloor.floors.find(f => f.level === 0) ?? multiFloor.floors[0];
      const geometry: FloorPlanGeometry = {
        footprint: { width: gf.footprintWidth, depth: gf.footprintDepth },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: gf.rooms.map(r => ({
          name: r.name,
          type: r.type as FloorPlanGeometry["rooms"][number]["type"],
          x: r.x, y: r.y, width: r.width, depth: r.depth,
          center: [r.x + r.width / 2, r.y + r.depth / 2] as [number, number],
          area: r.area,
        })),
      };

      const feedback = buildFeedback(project, prompt);
      // Adjacency scoring across ALL floors (not just ground)
      let totalAdj = 0, satisfiedAdj = 0;
      const allUnsatisfied: string[] = [];
      for (const fl of multiFloor.floors) {
        const adj = scoreAdjacency(fl.rooms, roomProgram.adjacency);
        totalAdj += adj.total;
        satisfiedAdj += adj.satisfied;
        allUnsatisfied.push(...adj.unsatisfied.map(u => `${u.roomA} ↔ ${u.roomB}`));
      }
      if (totalAdj > 0) {
        feedback.adjacency_score = {
          total: totalAdj,
          satisfied: satisfiedAdj,
          percentage: Math.round((satisfiedAdj / totalAdj) * 100),
          unsatisfied: allUnsatisfied,
        };
        if (allUnsatisfied.length > 0) {
          feedback.tips.push(`${allUnsatisfied.length} adjacency requirement(s) not met — drag rooms to rearrange.`);
        }
      }
      // DIAGNOSTIC — trace room counts at final output
      const allRoomNames = project.floors.flatMap(f => f.rooms.map(r => r.name));
      logger.debug('=== FINAL OUTPUT (multi-floor) ===');
      logger.debug('Total rooms:', allRoomNames.length);
      logger.debug('Room names:', JSON.stringify(allRoomNames));
      logger.debug('Floors:', JSON.stringify(project.floors.map(f => ({
        level: f.level,
        rooms: f.rooms.length,
        names: f.rooms.map(r => r.name)
      }))));

      await recordToolExecution(userId, "floor-plan");
      const layoutMetrics = computeLayoutMetrics(project);
      return NextResponse.json({
        project,
        geometry,
        svg: null,
        feedback,
        layoutMetrics,
        qualityFlags: layoutMetrics.quality_flags,
      });
    }

    // ── Stage 2: AI Spatial Layout (single floor) ──────────────────
    // GPT-4o positions rooms with zone-aware placement + validation + retry
    logger.debug(`[STAGE-2] Starting single-floor layout for ${roomProgram.rooms.length} rooms`);
    const floorPlan = await generateFloorPlan(description, apiKey, roomProgram);

    // ── Stage 3: Architectural Detailing ──────────────────────────────
    // Build FloorPlanGeometry → convertGeometryToProject (walls, doors, windows)
    const positionedRooms = floorPlan.positionedRooms;
    const roomList = floorPlan.roomList;

    const rooms = positionedRooms
      ? positionedRooms.map(r => ({
          name: r.name,
          type: r.type as "living" | "bedroom" | "kitchen" | "dining" | "bathroom" | "hallway" | "entrance" | "utility" | "balcony" | "other",
          x: r.x, y: r.y, width: r.width, depth: r.depth,
          center: [r.x + r.width / 2, r.y + r.depth / 2] as [number, number],
          area: r.area,
        }))
      : roomList.map((r) => {
          const area = r.area ?? 16;
          const w = Math.round(Math.sqrt(area * 1.2) * 10) / 10;
          const d = Math.round((area / w) * 10) / 10;
          return {
            name: r.name,
            type: ((r as Record<string, unknown>).type as string ?? "other") as "living" | "bedroom" | "kitchen" | "dining" | "bathroom" | "other",
            x: 0, y: 0, width: w, depth: d,
            center: [w / 2, d / 2] as [number, number],
            area,
          };
        });

    // Compute footprint from actual room bounding box (layout engine may
    // expand footprint beyond totalArea to fit corridor/zones)
    let bW: number, bD: number;
    if (positionedRooms && positionedRooms.length > 0) {
      bW = Math.round(Math.max(...positionedRooms.map(r => r.x + r.width)) * 10) / 10;
      bD = Math.round(Math.max(...positionedRooms.map(r => r.y + r.depth)) * 10) / 10;
    } else {
      const fpArea = floorPlan.totalArea / Math.max(floorPlan.floors, 1);
      const aspect = 1.33;
      bW = Math.round(Math.sqrt(fpArea * aspect) * 10) / 10;
      bD = Math.round((fpArea / bW) * 10) / 10;
    }

    const geometry: FloorPlanGeometry = {
      footprint: { width: bW, depth: bD },
      wallHeight: 3.0,
      walls: [], doors: [], windows: [],
      rooms,
    };

    const project = convertGeometryToProject(geometry, description.projectName, prompt);
    const feedback = buildFeedback(project, prompt);

    // DIAGNOSTIC — Stage 3 output
    const f0 = project.floors[0];
    logger.debug('=== STAGE 3 OUTPUT (single-floor) ===');
    logger.debug(`[STAGE-3] rooms: ${f0?.rooms.length}, walls: ${f0?.walls.length}, doors: ${f0?.doors.length}, windows: ${f0?.windows.length}`);
    logger.debug(`[STAGE-3] room areas: ${f0?.rooms.map(r => `${r.name}: ${r.area_sqm.toFixed(1)}m²`).join(', ')}`);
    if (f0 && f0.doors.length < 6) {
      console.warn(`[STAGE-3] ⚠️ Only ${f0.doors.length} doors for ${f0.rooms.length} rooms — may indicate gaps between rooms`);
    }
    logger.debug('=== FLOOR PLAN GENERATION COMPLETE ===');

    await recordToolExecution(userId, "floor-plan");
    const layoutMetrics = computeLayoutMetrics(project);
    return NextResponse.json({
      project,
      geometry,
      svg: floorPlan.svg,
      feedback,
      layoutMetrics,
      qualityFlags: layoutMetrics.quality_flags,
    });
  } catch (err) {
    console.error("[generate-floor-plan] Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════════════
// GRID-FIRST PIPELINE IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Multi-agent grid-first pipeline with feedback loop.
 *
 * Agent 2 (Designer): grid → assign → optimize bays → walls → project
 * Agent 3 (Checker): code validation + design quality
 * Coordinator: if critical issues, apply fixes and re-run Agent 2 (max 3 loops)
 */
async function runGridFirstPipeline(
  roomProgram: EnhancedRoomProgram,
  projectName: string,
  originalPrompt: string,
): Promise<{
  project: FloorPlanProject;
  geometry: FloorPlanGeometry;
  svg: null;
  feedback: ReturnType<typeof buildFeedback>;
} | null> {
  const MAX_GRID_RETRIES = 3;
  const MAX_DESIGN_LOOPS = 3;

  // Multi-floor path
  if (roomProgram.numFloors > 1) {
    return runGridMultiFloor(roomProgram, projectName, originalPrompt);
  }

  let bestProject: FloorPlanProject | null = null;
  let bestGeometry: FloorPlanGeometry | null = null;
  let bestScore = 0;
  let bestFeedback: ReturnType<typeof buildFeedback> | null = null;
  let bestDesignReport: ReturnType<typeof checkDesignQuality> | null = null;

  // ── Coordinator outer loop: design iterations ──
  for (let designLoop = 0; designLoop < MAX_DESIGN_LOOPS; designLoop++) {
    logger.debug(`[COORDINATOR] Design loop ${designLoop + 1}/${MAX_DESIGN_LOOPS}`);

    // ── Agent 2: Designer — Template + Optimizer → snap to grid ──
    // Primary path: typology template → SA optimizer → grid snap
    // Fallback: BSP → grid snap (existing path)

    let layoutRooms: Array<{ name: string; type: string; x: number; y: number; width: number; depth: number }>;
    let fpWidth: number;
    let fpDepth: number;
    let designerSource = 'template';

    const templateMatch = matchTypology(roomProgram);

    if (templateMatch && templateMatch.confidence >= 0.5) {
      // ── Template path ──
      logger.debug(`[AGENT-2] Template: ${templateMatch.template.id} (confidence ${templateMatch.confidence.toFixed(2)})`);

      // Convert ScaledRoom[] to PlacedRoom[] for the optimizer
      const placedRooms: OptimizerPlacedRoom[] = templateMatch.scaledRooms.map(sr => {
        const spec = roomProgram.rooms.find(r => r.name === sr.name);
        const cls = classifyRoom(sr.type, sr.name);
        const rule = getRoomRule(cls);
        return {
          id: sr.slotId,
          name: sr.name,
          type: sr.type,
          x: sr.x,
          y: sr.y,
          width: sr.width,
          depth: sr.depth,
          zone: sr.zone as OptimizerPlacedRoom['zone'],
          targetArea: spec?.areaSqm ?? sr.width * sr.depth,
          mustHaveExteriorWall: rule.exteriorWall === 'required',
        };
      });

      fpWidth = templateMatch.footprint.width;
      fpDepth = templateMatch.footprint.depth;

      // Add overflow rooms (rooms in program but not in any template slot)
      if (templateMatch.overflowRooms.length > 0) {
        for (const overflowName of templateMatch.overflowRooms) {
          const spec = roomProgram.rooms.find(r => r.name === overflowName);
          if (!spec) continue;
          const cls = classifyRoom(spec.type, spec.name);
          const rule = getRoomRule(cls);
          const w = Math.max(rule.width.min, Math.sqrt(spec.areaSqm));
          const d = Math.max(rule.depth.min, spec.areaSqm / w);
          placedRooms.push({
            id: `overflow_${overflowName.toLowerCase().replace(/\s+/g, '_')}`,
            name: overflowName,
            type: cls,
            x: 0,
            y: 0,
            width: Math.round(w * 10) / 10,
            depth: Math.round(d * 10) / 10,
            zone: (spec.zone as OptimizerPlacedRoom['zone']) ?? 'service',
            targetArea: spec.areaSqm,
            mustHaveExteriorWall: rule.exteriorWall === 'required',
          });
        }
        // Expand footprint if needed to fit overflow rooms
        const totalNeeded = placedRooms.reduce((s, r) => s + r.targetArea, 0);
        const currentArea = fpWidth * fpDepth;
        if (totalNeeded > currentArea * 0.9) {
          const scale = Math.sqrt(totalNeeded / (currentArea * 0.85));
          fpWidth = Math.round(fpWidth * scale * 10) / 10;
          fpDepth = Math.round(fpDepth * scale * 10) / 10;
        }
      }

      // Run optimizer
      const optResult = optimizeLayout(placedRooms, { width: fpWidth, depth: fpDepth }, roomProgram);
      const improvement = optResult.initialEnergy > 0
        ? ((1 - optResult.energy.total / optResult.initialEnergy) * 100).toFixed(0)
        : '0';
      logger.debug(`[AGENT-2] Optimizer: ${optResult.initialEnergy.toFixed(0)} → ${optResult.energy.total.toFixed(0)} (${improvement}% improvement, ${optResult.timeMs.toFixed(0)}ms)`);

      layoutRooms = optResult.rooms.map(r => ({
        name: r.name, type: r.type, x: r.x, y: r.y, width: r.width, depth: r.depth,
      }));
    } else {
      // ── BSP fallback path ──
      designerSource = 'bsp';
      logger.debug(`[AGENT-2] No template match — using BSP seed`);
      const bspRooms = layoutFloorPlan(roomProgram);
      if (bspRooms.length === 0) {
        return bestProject ? { project: bestProject, geometry: bestGeometry!, svg: null, feedback: bestFeedback! } : null;
      }

      fpWidth = Math.max(...bspRooms.map(r => r.x + r.width));
      fpDepth = Math.max(...bspRooms.map(r => r.y + r.depth));
      logger.debug(`[AGENT-2] BSP: ${bspRooms.length} rooms, ${fpWidth.toFixed(1)}m × ${fpDepth.toFixed(1)}m`);

      // Optimize BSP output
      const placedRooms: OptimizerPlacedRoom[] = bspRooms.map(r => {
        const cls = classifyRoom(r.type, r.name);
        const rule = getRoomRule(cls);
        return {
          id: r.name.toLowerCase().replace(/\s+/g, '_'),
          name: r.name,
          type: cls,
          x: r.x, y: r.y, width: r.width, depth: r.depth,
          zone: inferZoneFromType(cls),
          targetArea: r.area ?? r.width * r.depth,
          mustHaveExteriorWall: rule.exteriorWall === 'required',
        };
      });

      const optResult = optimizeLayout(placedRooms, { width: fpWidth, depth: fpDepth }, roomProgram);
      logger.debug(`[AGENT-2] BSP+Optimizer: ${optResult.initialEnergy.toFixed(0)} → ${optResult.energy.total.toFixed(0)} (${optResult.timeMs.toFixed(0)}ms)`);

      layoutRooms = optResult.rooms.map(r => ({
        name: r.name, type: r.type, x: r.x, y: r.y, width: r.width, depth: r.depth,
      }));
    }

    // Step B: Snap optimized rooms to structural grid
    const grid = computeGridFromRooms(layoutRooms, fpWidth, fpDepth);
    const assignment = mapBSPRoomsToGridCells(grid, layoutRooms);
    logger.debug(`[AGENT-2] Grid: ${grid.gridCols}×${grid.gridRows} (${grid.cells.length} cells), mapped ${assignment.roomOrder.length} rooms, source: ${designerSource}`);

    // Step C: Generate walls from the structural grid (guaranteed continuous)
    const wallSystem = generateWallsFromGrid(grid, assignment);

    // Step D: Build geometry + project
    const geometry = buildGeometryFromGrid(grid, assignment, wallSystem);
    const project = convertGridToProject(
      grid, assignment, wallSystem, projectName, originalPrompt,
      templateMatch?.template.connections,
    );

    const optimizedGrid = grid; // For feedback

    if (!project) {
      return bestProject ? { project: bestProject, geometry: bestGeometry!, svg: null, feedback: bestFeedback! } : null;
    }

    // ── Agent 3: Checker — code compliance + design quality ──
    const codeReport = validateFinal(project);
    const designReport = checkDesignQuality(project);
    const combinedScore = Math.round(codeReport.score * 0.6 + designReport.score * 0.4);

    logger.debug(`[AGENT-3] Code: ${codeReport.score}, Design: ${designReport.score} (${designReport.grade}), Combined: ${combinedScore}`);
    if (designReport.issues.length > 0) {
      const criticals = designReport.issues.filter(i => i.severity === 'critical');
      const warnings = designReport.issues.filter(i => i.severity === 'warning');
      logger.debug(`[AGENT-3] Design issues: ${criticals.length} critical, ${warnings.length} warnings`);
    }

    // Track best result
    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestProject = project;
      bestGeometry = geometry;
      bestDesignReport = designReport;
      bestFeedback = buildFeedback(project, originalPrompt);
      bestFeedback.tips.push(`Grid-first layout: ${optimizedGrid.gridCols}×${optimizedGrid.gridRows} structural grid`);
      bestFeedback.tips.push(`Design quality: ${designReport.grade} (${designReport.score}/100)`);
      if (codeReport.warnings.length > 0) {
        bestFeedback.tips.push(`${codeReport.warnings.length} code warning(s) — review in Code panel`);
      }
      // Adjacency scoring
      if (roomProgram.adjacency.length > 0) {
        const placedRooms = geometry.rooms.map(r => ({
          name: r.name, type: r.type,
          x: r.x ?? r.center[0] - r.width / 2,
          y: r.y ?? r.center[1] - r.depth / 2,
          width: r.width, depth: r.depth,
          area: r.area ?? r.width * r.depth,
        }));
        const adjScore = scoreAdjacency(placedRooms, roomProgram.adjacency);
        if (adjScore.total > 0) {
          bestFeedback.adjacency_score = {
            total: adjScore.total, satisfied: adjScore.satisfied,
            percentage: Math.round((adjScore.satisfied / adjScore.total) * 100),
            unsatisfied: adjScore.unsatisfied.map(u => `${u.roomA} ↔ ${u.roomB}`),
          };
        }
      }
    }

    // ── Coordinator: check if good enough or apply fixes ──
    if (codeReport.critical.length === 0 && designReport.score >= 70) {
      logger.debug(`[COORDINATOR] Score ${combinedScore} meets threshold — accepting`);
      break;
    }

    // Collect fix actions from both reports
    const fixes: Array<ValidationFixAction | DesignFix> = [];
    for (const issue of codeReport.critical) {
      if (issue.fixAction) fixes.push(issue.fixAction);
    }
    for (const issue of designReport.issues) {
      if (issue.severity === 'critical' && issue.fixAction) fixes.push(issue.fixAction);
    }

    if (fixes.length === 0) {
      logger.debug(`[COORDINATOR] No actionable fixes — using best result`);
      break;
    }

    // Apply fixes to room program for next design iteration
    logger.debug(`[COORDINATOR] Applying ${fixes.length} fixes for next iteration`);
    for (const fix of fixes) {
      applyFixToProgram(roomProgram, fix);
    }
  }

  if (!bestProject || !bestGeometry || !bestFeedback) return null;

  // Add design issues to feedback if any
  if (bestDesignReport) {
    const critDesign = bestDesignReport.issues.filter(i => i.severity === 'critical');
    for (const issue of critDesign) {
      bestFeedback.tips.push(`Design: ${issue.message}`);
    }
  }

  return { project: bestProject, geometry: bestGeometry, svg: null, feedback: bestFeedback };
}

/**
 * Apply a fix action to the room program for the next design iteration.
 */
function applyFixToProgram(
  program: EnhancedRoomProgram,
  fix: ValidationFixAction | DesignFix,
): void {
  switch (fix.type) {
    case 'resize_room': {
      const roomName = fix.params.room as string | undefined;
      const targetArea = fix.params.targetArea as number | undefined;
      if (roomName && targetArea) {
        const room = program.rooms.find(r => r.name === roomName);
        if (room && room.areaSqm < targetArea) {
          room.areaSqm = targetArea;
          // Update total area if needed
          const newTotal = program.rooms.reduce((s, r) => s + r.areaSqm, 0);
          if (newTotal > program.totalAreaSqm) program.totalAreaSqm = newTotal;
        }
      }
      break;
    }
    case 'add_bay':
      // Inflate total area to force larger grid on next attempt
      program.totalAreaSqm *= 1.2;
      break;
    case 'swap_rooms':
      // Swap rooms' zone preferences so the Designer places them differently
      // The room needing perimeter gets zone 'public' (placed near entrance/perimeter)
      {
        const roomName = fix.params.room as string | undefined;
        if (roomName) {
          const room = program.rooms.find(r => r.name === roomName);
          if (room) room.mustHaveExteriorWall = true;
        }
      }
      break;
    case 'add_adjacency': {
      const roomA = fix.params.roomA as string | undefined;
      const roomB = fix.params.roomB as string | undefined;
      const reason = (fix.params.reason as string) ?? 'design quality fix';
      if (roomA && roomB) {
        const exists = program.adjacency.some(
          a => (a.roomA === roomA && a.roomB === roomB) || (a.roomA === roomB && a.roomB === roomA)
        );
        if (!exists) {
          program.adjacency.push({ roomA, roomB, reason });
        }
      }
      break;
    }
    case 'move_room_to_perimeter': {
      const roomName = fix.params.room as string | undefined;
      if (roomName) {
        const room = program.rooms.find(r => r.name === roomName);
        if (room) room.mustHaveExteriorWall = true;
      }
      break;
    }
    case 'change_bay_size':
      // Already handled by area inflation in the inner retry loop
      break;
  }
}

/**
 * Grid-first pipeline for multi-floor buildings.
 */
function runGridMultiFloor(
  roomProgram: EnhancedRoomProgram,
  projectName: string,
  originalPrompt: string,
): {
  project: FloorPlanProject;
  geometry: FloorPlanGeometry;
  svg: null;
  feedback: ReturnType<typeof buildFeedback>;
} | null {
  try {
    const coordination = coordinateFloors(roomProgram);

    // Optimize bay dimensions per floor, then generate walls
    const optimizedGrids: typeof coordination.grid[] = [];
    const wallSystems = coordination.floors.map(fl => {
      const optGrid = optimizeBayDimensions(coordination.grid, fl.assignment);
      optimizedGrids.push(optGrid);
      return generateWallsFromGrid(optGrid, fl.assignment);
    });
    // Use the ground floor's optimized grid as the reference
    const refGrid = optimizedGrids[0] ?? coordination.grid;
    coordination.grid = refGrid;

    // Convert to project
    const project = convertGridFloorCoordinationToProject(
      coordination,
      wallSystems,
      projectName,
      originalPrompt,
    );

    // Build ground floor geometry for backward-compatible rendering
    const gf = coordination.floors.find(f => f.level === 0) ?? coordination.floors[0];
    const geometry = buildGeometryFromGrid(refGrid, gf.assignment, wallSystems[0]);

    const feedback = buildFeedback(project, originalPrompt);
    feedback.tips.push(`Grid-first layout: ${coordination.grid.gridCols}×${coordination.grid.gridRows} structural grid, ${coordination.floors.length} floors`);

    const finalValidation = validateFinal(project);
    if (finalValidation.warnings.length > 0) {
      feedback.tips.push(`${finalValidation.warnings.length} validation warning(s)`);
    }

    logger.debug('=== GRID-FIRST MULTI-FLOOR OUTPUT ===');
    logger.debug(`Floors: ${project.floors.length}, Total rooms: ${project.floors.reduce((s, f) => s + f.rooms.length, 0)}`);

    return { project, geometry, svg: null, feedback };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[GRID-FIRST] Multi-floor pipeline failed: ${msg}`);
    return null;
  }
}

/**
 * Infer room zone from classified type (for BSP fallback path).
 */
function inferZoneFromType(cls: string): OptimizerPlacedRoom['zone'] {
  if (['living_room', 'dining_room', 'drawing_room', 'foyer', 'entrance_lobby'].includes(cls)) return 'public';
  if (['bedroom', 'master_bedroom', 'guest_bedroom', 'children_bedroom', 'study', 'home_office'].includes(cls)) return 'private';
  if (['corridor', 'hallway', 'passage', 'staircase', 'lift'].includes(cls)) return 'circulation';
  if (['balcony', 'verandah', 'terrace', 'garden', 'parking', 'car_porch'].includes(cls)) return 'outdoor';
  return 'service';
}
