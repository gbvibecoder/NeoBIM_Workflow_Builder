/**
 * Brief-to-Renders upload hook.
 *
 * Two-step pipeline:
 *   1. POST /api/upload-brief  (multipart) → R2 URL.
 *   2. POST /api/brief-renders (JSON, idempotency-keyed) → jobId.
 *
 * Idempotency: a single key per browser session, persisted to
 * `localStorage` so the same upload retried after a refresh hits the
 * same `requestId` server-side. Cleared on success so the next upload
 * mints a new key.
 *
 * Validation lives client-side too (extension + size) so we fail fast
 * before consuming the user's bandwidth on a 50 MB upload that would
 * be rejected at the API anyway. The server is still the source of
 * truth — it re-validates magic bytes on top of these checks.
 *
 * Errors are surfaced as `{ kind, message }` so the BriefUploader can
 * branch on `kind` for UX (e.g. retry button only on transient kinds).
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MAX_BRIEF_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".docx"] as const;

const IDEMPOTENCY_KEY_STORAGE = "brief-renders:idempotency-key";

type UploadErrorKind =
  | "validation"
  | "upload"
  | "create-job"
  | "rate-limit"
  | "concurrency"
  | "unauthorized"
  | "feature-disabled"
  | "network";

export interface UploadError {
  kind: UploadErrorKind;
  message: string;
  status?: number;
}

export type UploadPhase =
  | "idle"
  | "validating"
  | "uploading"
  | "creating-job"
  | "success"
  | "error";

export interface UploadResult {
  jobId: string;
  briefUrl: string;
  fileName: string;
  fileSize: number;
}

export interface UseBriefRenderUploadResult {
  phase: UploadPhase;
  uploadProgress: number;
  result: UploadResult | null;
  error: UploadError | null;
  upload: (file: File) => Promise<void>;
  reset: () => void;
}

function classifyExtension(filename: string): "pdf" | "docx" | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  return null;
}

function readIdempotencyKey(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  try {
    const stored = window.localStorage.getItem(IDEMPOTENCY_KEY_STORAGE);
    if (stored && stored.length > 0) return stored;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(IDEMPOTENCY_KEY_STORAGE, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

function clearIdempotencyKey(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(IDEMPOTENCY_KEY_STORAGE);
  } catch {
    // localStorage might be disabled (Safari private mode) — fail silent.
  }
}

/**
 * Public escape hatch for the "Start a new brief" flow. Callers (e.g.
 * `BriefRenderShell.handleStartOver`) invoke this when transitioning
 * out of a terminal job so the next upload mints a fresh idempotency
 * key — even if the previous attempt never reached `success`.
 */
export function resetBriefRenderUploadIdempotencyKey(): void {
  clearIdempotencyKey();
}

function statusToErrorKind(status: number): UploadErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "feature-disabled";
  if (status === 429) return "rate-limit";
  return "create-job";
}

/**
 * Extracts a human-readable message from a structured error payload.
 * Handles both `{ message }` and `{ error: { message } }` shapes
 * (the latter is what `formatErrorResponse` returns project-wide).
 */
function extractMessageFromJson(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const top = payload as { message?: unknown; title?: unknown; error?: unknown };
  if (typeof top.message === "string" && top.message.length > 0) return top.message;
  if (top.error && typeof top.error === "object") {
    const inner = top.error as { message?: unknown; title?: unknown };
    if (typeof inner.message === "string" && inner.message.length > 0) return inner.message;
    if (typeof inner.title === "string" && inner.title.length > 0) return inner.title;
  }
  if (typeof top.title === "string" && top.title.length > 0) return top.title;
  return null;
}

/**
 * Parse a raw response body string into a friendly message. Used by the
 * XHR upload-error path which only sees the body as text. Falls back to
 * the truncated raw body if parsing fails.
 */
function friendlyErrorFromBody(body: string, fallbackStatus: number): string {
  if (!body) return `HTTP ${fallbackStatus}`;
  try {
    const parsed = JSON.parse(body);
    const msg = extractMessageFromJson(parsed);
    if (msg) return msg;
  } catch {
    // Not JSON — fall through.
  }
  return body.slice(0, 200);
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.clone().json();
    const msg = extractMessageFromJson(json);
    if (msg) return msg;
  } catch {
    // Body wasn't JSON — fall through to text.
  }
  try {
    const txt = await res.text();
    return txt.slice(0, 200) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

interface UploadBriefResponse {
  briefUrl: string;
  fileName: string;
  fileSize: number;
}

interface CreateJobResponse {
  jobId: string;
}

function uploadWithProgress(
  file: File,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<UploadBriefResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

    xhr.open("POST", "/api/upload-brief");
    xhr.withCredentials = true;

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as UploadBriefResponse;
          resolve(body);
        } catch {
          reject(
            Object.assign(new Error("Upload response was not JSON"), {
              status: xhr.status,
            }),
          );
        }
      } else {
        reject(
          Object.assign(new Error(xhr.responseText || `HTTP ${xhr.status}`), {
            status: xhr.status,
          }),
        );
      }
    });

    xhr.addEventListener("error", () => {
      reject(Object.assign(new Error("Network error during upload"), { status: 0 }));
    });

    xhr.addEventListener("abort", () => {
      reject(Object.assign(new Error("Upload aborted"), { status: 0, aborted: true }));
    });

    signal.addEventListener("abort", () => xhr.abort());

    xhr.send(formData);
  });
}

export function useBriefRenderUpload(): UseBriefRenderUploadResult {
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      if (abortRef.current) abortRef.current.abort();
    },
    [],
  );

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setPhase("idle");
    setUploadProgress(0);
    setResult(null);
    setError(null);
  }, []);

  const upload = useCallback(async (file: File) => {
    setError(null);
    setResult(null);
    setUploadProgress(0);
    setPhase("validating");

    const ext = classifyExtension(file.name);
    if (!ext) {
      setPhase("error");
      setError({
        kind: "validation",
        message: `Brief must end in ${ALLOWED_EXTENSIONS.join(" or ")}.`,
      });
      return;
    }
    if (file.size === 0) {
      setPhase("error");
      setError({ kind: "validation", message: "File is empty." });
      return;
    }
    if (file.size > MAX_BRIEF_SIZE_BYTES) {
      setPhase("error");
      setError({
        kind: "validation",
        message: `File exceeds the ${MAX_BRIEF_SIZE_BYTES / 1024 / 1024} MB limit.`,
      });
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let uploadResponse: UploadBriefResponse;
    try {
      setPhase("uploading");
      uploadResponse = await uploadWithProgress(
        file,
        setUploadProgress,
        controller.signal,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      const status =
        typeof err === "object" && err !== null && "status" in err
          ? (err as { status?: number }).status ?? 0
          : 0;
      // The XHR rejects with `err.message = xhr.responseText` (a JSON
      // string for our 5xx envelope). Pull the inner message out so the
      // UI shows "Failed to upload brief to storage. R2 may not be
      // configured." instead of the raw JSON dump.
      const rawMessage = err instanceof Error ? err.message : "Upload failed.";
      const message =
        status > 0 ? friendlyErrorFromBody(rawMessage, status) : rawMessage;
      setPhase("error");
      setError({
        kind: status === 0 ? "network" : status === 429 ? "rate-limit" : "upload",
        message,
        status,
      });
      return;
    }

    setPhase("creating-job");
    const idempotencyKey = readIdempotencyKey();

    let createRes: Response;
    try {
      createRes = await fetch("/api/brief-renders", {
        method: "POST",
        credentials: "include",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ briefUrl: uploadResponse.briefUrl }),
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setPhase("error");
      setError({
        kind: "network",
        message: err instanceof Error ? err.message : "Failed to reach server.",
      });
      return;
    }

    if (!createRes.ok) {
      const message = await readErrorMessage(createRes);
      setPhase("error");
      setError({
        kind: statusToErrorKind(createRes.status),
        message,
        status: createRes.status,
      });
      return;
    }

    let createBody: CreateJobResponse;
    try {
      createBody = (await createRes.json()) as CreateJobResponse;
    } catch {
      setPhase("error");
      setError({ kind: "create-job", message: "Server response was not JSON." });
      return;
    }

    if (!createBody.jobId) {
      setPhase("error");
      setError({ kind: "create-job", message: "Server response missing jobId." });
      return;
    }

    clearIdempotencyKey();
    setResult({
      jobId: createBody.jobId,
      briefUrl: uploadResponse.briefUrl,
      fileName: uploadResponse.fileName,
      fileSize: uploadResponse.fileSize,
    });
    setPhase("success");
  }, []);

  return { phase, uploadProgress, result, error, upload, reset };
}
