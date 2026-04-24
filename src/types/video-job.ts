/**
 * Shared types for the background VideoJob pipeline.
 *
 * VideoJob replaces the legacy "client-side polls Kling directly" flow for
 * GN-009 (and future video-producing nodes). The handler creates a VideoJob
 * row immediately after submitting Kling tasks and enqueues a QStash worker.
 * Every subsequent state transition lives in Postgres; the client polls our
 * own API instead of Kling's.
 *
 * These types are imported by:
 *   • services/video-job-service.ts   — worker brain
 *   • app/api/video-worker/poll       — QStash endpoint
 *   • app/api/video-jobs/[id]         — client-facing read endpoint
 *   • hooks/useVideoJob               — React polling hook
 *   • components/artifacts/VideoBody  — segment-aware renderer
 */

/** Which Kling endpoint produced this job. Drives per-task GET path selection. */
export type VideoPipeline = "image2video" | "text2video" | "omni";

/** Per-segment semantic label. "single" is used for floor-plan Omni (one clip). */
export type VideoSegmentKind = "exterior" | "interior" | "single";

/** Per-segment status. Mirrors Kling's task_status vocabulary plus our terminal states. */
export type VideoSegmentStatus = "submitted" | "processing" | "complete" | "failed";

/** Stored verbatim in VideoJob.segments JSON. One entry per Kling task. */
export interface VideoSegmentRecord {
  kind: VideoSegmentKind;
  taskId: string;
  status: VideoSegmentStatus;
  /** Kling's short-lived CDN URL. Kept for fallback if R2 persist failed. */
  klingUrl?: string;
  /** Permanent R2 URL. Preferred for playback. */
  r2Url?: string;
  durationSeconds: number;
  submittedAt: string; // ISO
  completedAt?: string; // ISO
  failureReason?: string;
  /** Count of R2 persist retries already attempted. Capped at 5 before we
   *  mark the segment complete using klingUrl only. */
  r2RetryCount?: number;
}

/** Overall job status. */
export type VideoJobStatus =
  | "queued"
  | "processing"
  | "partial"
  | "complete"
  | "failed";

/** Shape returned by GET /api/video-jobs/[id]. Safe for client consumption. */
export interface VideoJobClientView {
  id: string;
  status: VideoJobStatus;
  pipeline: VideoPipeline;
  isRenovation: boolean;
  isFloorPlan: boolean;
  /** Raw per-segment state — includes pending segments so the UI can show
   *  "waiting" chips. Never contains Kling taskIds (scrubbed server-side). */
  segments: Array<
    Pick<
      VideoSegmentRecord,
      "kind" | "status" | "durationSeconds" | "completedAt" | "failureReason"
    > & {
      /** Playable URL if segment is complete (prefers r2Url over klingUrl). */
      url?: string;
    }
  >;
  totalDurationSeconds?: number;
  costUsd?: number;
  failureReason?: string;
  /** Computed 0–100 for UI progress bars. */
  progress: number;
  /** First playable segment's URL, prioritizing exterior/single over interior. */
  primaryVideoUrl?: string;
  /** All complete segments as lightweight playback records. */
  playableSegments: Array<{
    kind: VideoSegmentKind;
    url: string;
    durationSeconds: number;
  }>;
  updatedAt: string;
}
