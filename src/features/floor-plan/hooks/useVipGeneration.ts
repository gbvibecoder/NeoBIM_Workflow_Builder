/**
 * React hook for VIP background floor plan generation.
 *
 * Manages the full lifecycle: create job → poll → completed/failed.
 * Polling: 3s interval, 10-minute max. Cleanup on unmount.
 */

"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { FloorPlanProject } from "@/types/floor-plan-cad";

// ─── Types ───────────────────────────────────────────────────────

export type VipGenerationStatus =
  | "idle"
  | "creating"
  | "polling"
  | "completed"
  | "failed";

const STAGE_LABELS: Record<string, string> = {
  parse: "Understanding your requirements",
  stage1: "Creating architectural brief",
  stage2: "Generating floor plan images",
  "stage2-retry": "Regenerating images (improving quality)",
  stage3: "Evaluating image quality",
  "stage3-retry": "Re-evaluating quality",
  stage4: "Extracting room layouts",
  stage5: "Building CAD geometry",
  "stage5-retry": "Rebuilding geometry",
  stage6: "Quality checking",
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
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [project, setProject] = useState<FloorPlanProject | null>(null);

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

      if (job.status === "COMPLETED" && job.resultProject) {
        stopPolling();
        setProject(job.resultProject);
        setStatus("completed");
        setProgress(100);
        setStageLabel("Done!");
      } else if (job.status === "FAILED" || job.status === "CANCELLED") {
        stopPolling();
        setStatus("failed");
        setErrorMessage(
          job.errorMessage ?? "Something went wrong generating your floor plan. Try again?",
        );
      }
      // QUEUED or RUNNING — continue polling
    } catch {
      // Network error — continue polling (might be transient)
    }
  }, [stopPolling]);

  const startGeneration = useCallback(async (prompt: string) => {
    // Reset state
    setStatus("creating");
    setProgress(0);
    setCurrentStage(null);
    setStageLabel("Submitting your request...");
    setCostUsd(0);
    setQualityScore(null);
    setErrorMessage(null);
    setProject(null);
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
  }, [stopPolling]);

  return {
    status,
    progress,
    currentStage,
    stageLabel,
    costUsd,
    qualityScore,
    errorMessage,
    project,
    startGeneration,
    cancel,
  };
}
