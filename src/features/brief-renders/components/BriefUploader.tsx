/**
 * BriefUploader — drag-and-drop entry point for the Brief-to-Renders flow.
 *
 * Presents a drop zone + file picker, then drives the two-step upload
 * sequence via `useBriefRenderUpload`. On success, calls `onJobCreated`
 * with the new `jobId` so the parent shell can switch to the polling
 * view. On error, renders an inline diagnostic message; transient
 * kinds (`upload`, `network`, `rate-limit`) get a "Try again" button.
 *
 * The component is purely presentational once `useBriefRenderUpload`
 * does the work — no fetch logic lives here.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useBriefRenderUpload } from "@/features/brief-renders/hooks/useBriefRenderUpload";

const ACCEPTED_MIME =
  "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ACCEPTED_EXT_LABEL = "PDF or DOCX, ≤ 50 MB";

export interface BriefUploaderProps {
  onJobCreated: (jobId: string) => void;
  /** Optional override — disables the picker (e.g. parent has an active job). */
  disabled?: boolean;
}

export function BriefUploader({ onJobCreated, disabled = false }: BriefUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const { phase, uploadProgress, result, error, upload, reset } =
    useBriefRenderUpload();

  const isBusy =
    phase === "validating" || phase === "uploading" || phase === "creating-job";
  const isLocked = disabled || isBusy;

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const first = files[0];
      await upload(first);
    },
    [upload],
  );

  // Surface the new job to the parent the moment we have it. Effect
  // (not render) so we don't trigger React's "called setState during
  // render" warning, and so the parent only sees each jobId once.
  useEffect(() => {
    if (phase === "success" && result) {
      onJobCreated(result.jobId);
    }
  }, [phase, result, onJobCreated]);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (isLocked) return;
      void handleFiles(e.dataTransfer?.files ?? null);
    },
    [handleFiles, isLocked],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (isLocked) return;
      setDragActive(true);
    },
    [isLocked],
  );

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const onPick = useCallback(() => {
    if (isLocked) return;
    inputRef.current?.click();
  }, [isLocked]);

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void handleFiles(e.target.files);
      // Reset so the same file can be picked twice.
      e.target.value = "";
    },
    [handleFiles],
  );

  const showRetry = error && (error.kind === "upload" || error.kind === "network" || error.kind === "rate-limit");

  return (
    <section
      aria-label="Upload brief"
      className="bg-zinc-900 text-zinc-100 p-6 rounded-lg space-y-4"
    >
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Upload your brief</h2>
        <p className="text-sm text-zinc-400">
          Architectural brief in PDF or DOCX. We&apos;ll extract the spec and
          surface it for review before generating any images.
        </p>
      </header>

      <div
        role="button"
        tabIndex={isLocked ? -1 : 0}
        aria-disabled={isLocked}
        aria-busy={isBusy}
        onClick={onPick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPick();
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        className={[
          "border-2 border-dashed rounded-lg px-6 py-10 text-center cursor-pointer transition-colors",
          isLocked
            ? "border-zinc-700 bg-zinc-950 cursor-not-allowed opacity-60"
            : dragActive
              ? "border-cyan-500 bg-cyan-950/30"
              : "border-zinc-700 bg-zinc-950 hover:border-zinc-500",
        ].join(" ")}
        data-testid="brief-uploader-dropzone"
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_MIME}
          className="hidden"
          onChange={onChange}
          disabled={isLocked}
          data-testid="brief-uploader-input"
        />
        <div className="text-sm text-zinc-300 font-medium">
          {dragActive ? "Drop to upload" : "Drag a brief here, or click to browse"}
        </div>
        <div className="text-xs text-zinc-500 mt-1">{ACCEPTED_EXT_LABEL}</div>
      </div>

      {(phase === "uploading" || phase === "creating-job") && (
        <div
          role="status"
          aria-live="polite"
          className="text-sm text-zinc-300 space-y-2"
          data-testid="brief-uploader-progress"
        >
          <div>
            {phase === "uploading"
              ? `Uploading… ${uploadProgress}%`
              : "Creating job…"}
          </div>
          <div className="h-1.5 w-full bg-zinc-800 rounded">
            <div
              className="h-full rounded bg-cyan-500 transition-all"
              style={{
                width:
                  phase === "creating-job"
                    ? "100%"
                    : `${Math.max(2, uploadProgress)}%`,
              }}
            />
          </div>
        </div>
      )}

      {phase === "validating" && (
        <div className="text-sm text-zinc-400" role="status" aria-live="polite">
          Validating file…
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="bg-red-950 border border-red-700 text-red-100 px-4 py-3 rounded text-sm space-y-2"
          data-testid="brief-uploader-error"
        >
          <div>{error.message}</div>
          {showRetry && (
            <button
              type="button"
              onClick={reset}
              className="text-xs underline text-red-200 hover:text-white"
            >
              Try again
            </button>
          )}
        </div>
      )}
    </section>
  );
}
