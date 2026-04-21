/**
 * React hook for VIP background floor plan generation.
 *
 * Manages the full lifecycle: create job → poll → completed/failed.
 * Polling: 3s interval, 10-minute max. Cleanup on unmount.
 */

"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { StageLogEntry } from "@/features/floor-plan/lib/vip-pipeline/types";

// ─── Types ───────────────────────────────────────────────────────

export type VipGenerationStatus =
  | "idle"
  | "creating"
  | "polling"
  // Phase 2.3 Workstream C: image approval gate — Stage 2 image is
  // ready and the user must approve or regenerate before Stage 3+
  // runs.
  | "awaiting-approval"
  | "completed"
  | "failed";

const STAGE_LABELS: Record<string, string> = {
  parse: "Understanding your requirements",
  stage1: "Creating architectural brief",
  stage2: "Generating floor plan images",
  stage3: "Evaluating image quality",
  stage4: "Extracting room layouts",
  stage5: "Building CAD geometry",
  stage6: "Quality checking",
  retry: "Refining the result",
  stage7: "Finalizing your floor plan",
  complete: "Done!",
};

interface VipJobResponse {
  id: string;
  status: string;
  progress: number;
  currentStage: string | null;
  costUsd: number;
  errorMessage: string | null;
  resultProject?: FloorPlanProject;
  // Phase 2.3 Workstream C
  intermediateImage?: string | null;
  userApproval?: string | null;
  pausedAt?: string | null;
  pausedStage?: number | null;
  // Phase 2.6: stage-by-stage log for the Pipeline Logs Panel.
  stageLog?: StageLogEntry[] | null;
}

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// ─── Hook ────────────────────────────────────────────────────────

export function useVipGeneration() {
  const [status, setStatus] = useState<VipGenerationStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [stageLabel, setStageLabel] = useState("");
  const [costUsd, setCostUsd] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [project, setProject] = useState<FloorPlanProject | null>(null);
  // Phase 2.3 Workstream C: approval-gate state.
  const [intermediateImage, setIntermediateImage] = useState<string | null>(null);
  // Phase 2.6: in-flight approval/regeneration actions (drive button
  // disabled + spinner states in ImageApprovalGate).
  const [approving, setApproving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  // Phase 2.6: stage-by-stage log for the Pipeline Logs Panel.
  const [stageLog, setStageLog] = useState<StageLogEntry[]>([]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const jobIdRef = useRef<string | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const pollJob = useCallback(async (jobId: string) => {
    // Check timeout
    if (Date.now() - startTimeRef.current > MAX_POLL_DURATION_MS) {
      stopPolling();
      setStatus("failed");
      setErrorMessage("Generation timed out. Please try again.");
      return;
    }

    try {
      const res = await fetch(`/api/vip-jobs/${jobId}`);
      if (!res.ok) {
        if (res.status === 404) {
          stopPolling();
          setStatus("failed");
          setErrorMessage("Job not found. Please try again.");
        }
        return;
      }

      const job: VipJobResponse = await res.json();

      setProgress(job.progress);
      setCurrentStage(job.currentStage);
      setStageLabel(
        STAGE_LABELS[job.currentStage ?? ""] ?? job.currentStage ?? "",
      );
      setCostUsd(job.costUsd);
      // Phase 2.6: refresh the stage log on every poll. The worker
      // replaces the column atomically on each event, so we can trust
      // the array we receive as authoritative.
      if (Array.isArray(job.stageLog)) setStageLog(job.stageLog);

      if (job.status === "COMPLETED" && job.resultProject) {
        stopPolling();
        setProject(job.resultProject);
        setStatus("completed");
        setProgress(100);
        setStageLabel("Done!");
      } else if (job.status === "AWAITING_APPROVAL") {
        // Phase 2.3 Workstream C: keep polling interval active — the
        // user's Approve/Regenerate click shifts the row back to
        // RUNNING/AWAITING_APPROVAL which the next poll picks up.
        setStatus("awaiting-approval");
        setIntermediateImage(job.intermediateImage ?? null);
        setStageLabel("Image ready — approve to continue");
      } else if (job.status === "FAILED" || job.status === "CANCELLED") {
        stopPolling();
        setStatus("failed");
        setErrorMessage(
          job.errorMessage ?? "Something went wrong generating your floor plan. Try again?",
        );
      } else {
        // QUEUED or RUNNING: if we were previously in awaiting-approval
        // and the user approved, transition back to polling.
        if (status === "awaiting-approval" && (job.status === "RUNNING" || job.status === "QUEUED")) {
          setStatus("polling");
          setIntermediateImage(null);
        }
      }
    } catch {
      // Network error — continue polling (might be transient)
    }
  }, [stopPolling, status]);

  const startGeneration = useCallback(async (prompt: string) => {
    // Reset state
    setStatus("creating");
    setProgress(0);
    setCurrentStage(null);
    setStageLabel("Submitting your request...");
    setCostUsd(0);
    setErrorMessage(null);
    setProject(null);
    setStageLog([]);
    stopPolling();

    try {
      const res = await fetch("/api/vip-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        setStatus("failed");
        setErrorMessage(
          data.error === "Max 5 concurrent VIP jobs. Wait for existing jobs to complete."
            ? "You have too many active generations. Please wait for one to finish."
            : data.error ?? "Failed to start generation. Please try again.",
        );
        return;
      }

      const { jobId } = await res.json();
      jobIdRef.current = jobId;
      startTimeRef.current = Date.now();
      setStatus("polling");
      setStageLabel("Starting generation...");

      // Start polling
      intervalRef.current = setInterval(() => pollJob(jobId), POLL_INTERVAL_MS);
      // Also poll immediately (don't wait 3s for first update)
      pollJob(jobId);
    } catch {
      setStatus("failed");
      setErrorMessage("Network error. Please check your connection and try again.");
    }
  }, [pollJob, stopPolling]);

  const cancel = useCallback(() => {
    stopPolling();
    setStatus("idle");
    setProgress(0);
    setCurrentStage(null);
    setStageLabel("");
    setErrorMessage(null);
    setIntermediateImage(null);
  }, [stopPolling]);

  // Phase 2.3 Workstream C: user approves the Stage 2 image.
  // Phase 2.6: tracks `approving` so the gate can disable buttons + show spinner.
  const approveImage = useCallback(async () => {
    const jobId = jobIdRef.current;
    if (!jobId || approving || regenerating) return;
    setApproving(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/vip-jobs/${jobId}/approve`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(data.error ?? "Failed to approve image. Try again?");
        return;
      }
      setStatus("polling");
      setIntermediateImage(null);
      setStageLabel("Generating CAD geometry...");
    } catch {
      setErrorMessage("Network error approving image. Try again?");
    } finally {
      setApproving(false);
    }
  }, [approving, regenerating]);

  // Phase 2.3 Workstream C: user rejects the image and wants a fresh one.
  // Phase 2.6: tracks `regenerating` so the gate can disable buttons + show spinner.
  const regenerateImage = useCallback(async () => {
    const jobId = jobIdRef.current;
    if (!jobId || approving || regenerating) return;
    setRegenerating(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/vip-jobs/${jobId}/regenerate-image`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(data.error ?? "Failed to regenerate image. Try again?");
        return;
      }
      // Poll will update status/progress as Stage 2 re-runs.
      setStatus("polling");
      setIntermediateImage(null);
      setStageLabel("Regenerating image...");
    } catch {
      setErrorMessage("Network error regenerating image. Try again?");
    } finally {
      setRegenerating(false);
    }
  }, [approving, regenerating]);

  return {
    status,
    progress,
    currentStage,
    stageLabel,
    costUsd,
    errorMessage,
    project,
    intermediateImage,
    approving,
    regenerating,
    stageLog,
    startGeneration,
    cancel,
    approveImage,
    regenerateImage,
  };
}
