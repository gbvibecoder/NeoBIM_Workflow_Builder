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

import s from "@/app/dashboard/brief-renders/page.module.css";
import { useBriefRenderUpload } from "@/features/brief-renders/hooks/useBriefRenderUpload";

const ACCEPTED_MIME =
  "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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
      e.target.value = "";
    },
    [handleFiles],
  );

  const showRetry =
    error &&
    (error.kind === "upload" ||
      error.kind === "network" ||
      error.kind === "rate-limit");

  return (
    <div className={s.uploadHero}>
      <div className={s.uploadHeroLeft}>
        <div className={s.uploadHeroEyebrow}>
          <div className={s.uploadHeroEyebrowDot} />
          Step 1 of 4 · Upload
        </div>
        <h2 className={s.uploadHeroTitle}>
          Upload your <em className={s.uploadHeroTitleEm}>brief.</em>
        </h2>
        <p className={s.uploadHeroLead}>
          Architectural brief in PDF or DOCX. We extract the spec —
          apartments, shots, materials, lighting — and surface every detail
          for review before any image generation begins.
        </p>

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
          className={s.dropzone}
          data-active={dragActive ? "true" : undefined}
          data-locked={isLocked ? "true" : undefined}
          data-testid="brief-uploader-dropzone"
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_MIME}
            className={s.hiddenInput}
            onChange={onChange}
            disabled={isLocked}
            data-testid="brief-uploader-input"
          />
          <div className={s.dropzoneIcon}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
              <path d="M12 12v9" />
              <path d="m16 16-4-4-4 4" />
            </svg>
          </div>
          <div className={s.dropzoneHeadline}>
            {dragActive
              ? "Drop to upload"
              : "Drag a brief here, or click to browse"}
          </div>
          <div className={s.dropzoneSub}>PDF or DOCX · ≤ 50 MB</div>
        </div>

        {/* Upload progress */}
        {(phase === "uploading" || phase === "creating-job") && (
          <div
            role="status"
            aria-live="polite"
            data-testid="brief-uploader-progress"
          >
            <p
              style={{
                fontSize: 13,
                color: "var(--rs-text)",
                marginTop: 14,
                marginBottom: 8,
              }}
            >
              {phase === "uploading"
                ? `Uploading… ${uploadProgress}%`
                : "Creating job…"}
            </p>
            <div className={s.stageProgress}>
              <div
                className={s.stageProgressFill}
                style={{
                  width:
                    phase === "creating-job"
                      ? "100%"
                      : `${Math.max(2, uploadProgress)}%`,
                }}
              >
                <div className={s.stageProgressShimmer} />
              </div>
            </div>
          </div>
        )}

        {phase === "validating" && (
          <p
            style={{
              fontSize: 13,
              color: "var(--rs-text-mute)",
              marginTop: 14,
            }}
            role="status"
            aria-live="polite"
          >
            Validating file…
          </p>
        )}

        {error && (
          <div
            role="alert"
            className={s.errorAlert}
            data-testid="brief-uploader-error"
          >
            <div>{error.message}</div>
            {showRetry && (
              <button type="button" onClick={reset} className={s.errorRetryBtn}>
                Try again
              </button>
            )}
          </div>
        )}

        <div className={s.uploadHeroTrust}>
          <span>Auto-extracted in 1–2 minutes</span>
          <div className={s.uploadHeroTrustDot} />
          <span>Reviewed before render</span>
        </div>
      </div>

      {/* Preview moodboard */}
      <div className={s.previewBoard} aria-hidden="true">
        <div className={`${s.previewTag} ${s.previewTag1}`}>
          <div className={s.previewTagDot} />
          13-page editorial PDF
        </div>
        <div className={`${s.previewTag} ${s.previewTag2}`}>
          <div className={`${s.previewTagDot} ${s.previewTagDotBlueprint}`} />
          4K · 6K hero
        </div>

        <div className={`${s.previewCard} ${s.previewCard1}`}>
          <div className={s.previewCardImg} />
          <div className={s.previewCardCorner}>
            <div className={s.previewCardCornerDot} />
            Hero · WE 01
          </div>
          <div className={s.previewCardMeta}>
            <div className={s.previewCardPage}>Page 2 · Shot 1 of 4</div>
            <div className={s.previewCardTitle}>
              Open <em className={s.previewCardTitleEm}>Kitchen-Dining</em>
            </div>
            <div className={s.previewCardRoom}>
              Kochen/Essen · 32.54 m² · 3:2
            </div>
          </div>
        </div>

        <div className={`${s.previewCard} ${s.previewCard2}`}>
          <div className={s.previewCardImg} />
          <div className={s.previewCardMeta}>
            <div className={s.previewCardPage}>Page 5 · Shot 1 of 4</div>
            <div className={s.previewCardTitle}>
              Primary <em className={s.previewCardTitleEm}>Bedroom</em>
            </div>
            <div className={s.previewCardRoom}>
              Schlafen · 18.22 m² · 3:2
            </div>
          </div>
        </div>

        <div className={`${s.previewCard} ${s.previewCard3}`}>
          <div className={s.previewCardImg} />
          <div className={s.previewCardMeta}>
            <div className={s.previewCardPage}>Page 9 · Shot 1 of 4</div>
            <div className={s.previewCardTitle}>
              Master <em className={s.previewCardTitleEm}>Bathroom</em>
            </div>
            <div className={s.previewCardRoom}>Bad · 8.10 m² · 2:3</div>
          </div>
        </div>
      </div>
    </div>
  );
}
