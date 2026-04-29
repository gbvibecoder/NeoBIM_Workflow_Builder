/**
 * Diagnose a stuck Brief→Renders job.
 *
 * Reads the job row directly from Postgres (using DATABASE_URL from
 * .env.local, same source the app uses) and prints a structured
 * summary that pinpoints which gate the pipeline is stuck at:
 *   • Did the worker get dispatched?           → `currentStage` / `stageLog` length
 *   • Did the worker mark a shot running?      → `shots[i].status`
 *   • Did OpenAI accept any image?             → `costUsd` (Stage-1-only vs >Stage-1)
 *   • Where in the stage timeline did it stop? → last `stageLog` entry
 *
 * Usage:
 *   npx tsx scripts/diagnose-brief-render-job.ts <jobId>
 *
 * No mutation — read-only. Safe against prod DB.
 */

/* eslint-disable no-console */

import * as fs from "node:fs";
import * as path from "node:path";

// .env.local loader — same shape as run-brief-renders-e2e.ts.
(function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

interface ShotShape {
  shotIndex: number;
  apartmentIndex: number | null;
  shotIndexInApartment: number;
  status: string;
  imageUrl: string | null;
  errorMessage: string | null;
  costUsd: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface StageLogShape {
  stage: number;
  name: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  costUsd: number | null;
  summary: string | null;
  error: string | null;
}

async function main(): Promise<void> {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: npx tsx scripts/diagnose-brief-render-job.ts <jobId>");
    process.exit(1);
  }

  // Same adapter shape as src/lib/db.ts — Prisma 7 with Neon serverless.
  const adapter = new PrismaNeon({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://placeholder/placeholder",
  });
  const prisma = new PrismaClient({ adapter });
  try {
    const job = await prisma.briefRenderJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      console.error(`Job ${jobId} not found in DB.`);
      process.exit(2);
    }

    const shots = (job.shots as unknown as ShotShape[] | null) ?? [];
    const stageLog =
      (job.stageLog as unknown as StageLogShape[] | null) ?? [];

    const counts = shots.reduce<Record<string, number>>((acc, s) => {
      acc[s.status] = (acc[s.status] ?? 0) + 1;
      return acc;
    }, {});

    console.log("─".repeat(72));
    console.log("Brief→Renders job diagnostic");
    console.log("─".repeat(72));
    console.log("jobId         :", job.id);
    console.log("requestId     :", job.requestId);
    console.log("status        :", job.status);
    console.log("currentStage  :", job.currentStage ?? "—");
    console.log("progress      :", job.progress, "%");
    console.log("userApproval  :", job.userApproval ?? "—");
    console.log("costUsd       :", `$${Number(job.costUsd).toFixed(3)}`);
    console.log("createdAt     :", job.createdAt.toISOString());
    console.log("startedAt     :", job.startedAt?.toISOString() ?? "—");
    console.log("updatedAt     :", job.updatedAt.toISOString());
    console.log("completedAt   :", job.completedAt?.toISOString() ?? "—");
    console.log("errorMessage  :", job.errorMessage ?? "—");
    console.log("");
    console.log("Shot counts   :", counts);
    console.log("");
    console.log("Stage log:");
    if (stageLog.length === 0) {
      console.log("  (empty — worker never wrote a stageLog entry)");
    } else {
      for (const e of stageLog) {
        const dur =
          e.durationMs !== null
            ? `${(e.durationMs / 1000).toFixed(1)}s`
            : "running…";
        console.log(
          `  S${e.stage} · ${e.name.padEnd(20)} · ${e.status.padEnd(8)} · ${dur.padEnd(10)} · ${e.summary ?? ""}`,
        );
        if (e.error) console.log(`     error: ${e.error}`);
      }
    }
    console.log("");
    console.log("Per-shot summary:");
    for (const s of shots) {
      const ai = (s.apartmentIndex ?? 0) + 1;
      const si = s.shotIndexInApartment + 1;
      const ts =
        s.completedAt ?? s.startedAt ?? "—";
      const cost =
        s.costUsd !== null && s.costUsd > 0
          ? `$${s.costUsd.toFixed(3)}`
          : "—";
      console.log(
        `  S${ai}.${si} · ${s.status.padEnd(8)} · cost ${cost.padEnd(8)} · ${ts}${s.errorMessage ? ` · err: ${s.errorMessage}` : ""}`,
      );
    }
    console.log("─".repeat(72));

    // ─── Diagnostic verdict ───────────────────────────────────────────
    const stage1Logged = stageLog.some(
      (e) => e.stage === 1 && e.status === "success",
    );
    const stage2Logged = stageLog.some(
      (e) => e.stage === 2 && e.status === "success",
    );
    const stage3Started = stageLog.some((e) => e.stage === 3);
    const anyShotRunning = shots.some((s) => s.status === "running");
    const anyShotSuccess = shots.some((s) => s.status === "success");
    const allCostsZero = shots.every(
      (s) => s.costUsd === null || s.costUsd === 0,
    );

    console.log("Verdict:");
    if (job.status !== "RUNNING") {
      console.log(`  Job is ${job.status} — not actively rendering.`);
    } else if (!stage1Logged) {
      console.log(
        "  Stage 1 hasn't completed. Spec extract is in flight or failed silently.",
      );
    } else if (!stage2Logged) {
      console.log(
        "  Stage 2 hasn't completed. Prompt generation should be instant — check for a deterministic crash.",
      );
    } else if (!stage3Started) {
      console.log(
        "  Stage 3 has NEVER been logged. The render worker has not been invoked even once.",
      );
      console.log(
        "  → Most likely: QStash dispatch failed / cloudflared tunnel is down. Check NEXT_PUBLIC_APP_URL.",
      );
    } else if (!anyShotRunning && !anyShotSuccess && allCostsZero) {
      console.log(
        "  Stage 3 was logged once but no shot transitioned to running/success.",
      );
      console.log(
        "  → The first worker invocation entered Stage 3, then either:",
      );
      console.log(
        "     (a) failed before the running write (provider auth/network)",
      );
      console.log("     (b) was re-enqueued but the next callback never arrived");
      console.log(
        "  → Look in the dev terminal for `[brief-renders]` lines or ImageGen errors.",
      );
    } else if (anyShotRunning) {
      const running = shots.find((s) => s.status === "running");
      console.log(
        `  Shot S${(running!.apartmentIndex ?? 0) + 1}.${running!.shotIndexInApartment + 1} is in 'running' state.`,
      );
      const startedAt = running!.startedAt
        ? new Date(running!.startedAt)
        : null;
      if (startedAt) {
        const elapsedMs = Date.now() - startedAt.getTime();
        console.log(`  Time in 'running' state: ${(elapsedMs / 1000).toFixed(0)}s`);
        if (elapsedMs > 90_000) {
          console.log(
            "  → Past lock TTL (90s). Worker likely died mid-render. Next worker dispatch should re-claim it.",
          );
        }
      }
    } else if (anyShotSuccess) {
      console.log(
        "  Pipeline is healthy — at least one shot has completed successfully.",
      );
    }
    console.log("─".repeat(72));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(3);
});
