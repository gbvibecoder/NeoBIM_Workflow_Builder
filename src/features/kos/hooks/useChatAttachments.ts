"use client";

/**
 * useChatAttachments — client-side state machine for the customer's
 * drawing attach flow (5I PR 1).
 *
 * Lifecycle for one attachment:
 *
 *   addFile(File)
 *     ├─ validateLocal — synchronous extension + size + emptiness check
 *     │     └─ on fail: emit { phase: "failed", canRetry: false }
 *     └─ performUpload (3-step):
 *           1. POST /api/kos/customer/drawings/upload-url  (presign)
 *              ├─ 401 → reBootstrapSession() then retry once
 *              ├─ 4xx → { phase: "failed", canRetry: false }
 *              └─ 5xx → { phase: "failed", canRetry: true }
 *           2. XHR PUT to the presigned URL (uses XHR for upload
 *              progress events; fetch can't expose those)
 *              └─ failure → { phase: "failed", canRetry: true }
 *           3. POST /api/kos/customer/drawings/{id}/confirm-upload
 *              └─ on 200 → { phase: "uploaded", drawingId, sizeBytes }
 *
 * The XHR PUT step is intentionally a thin Promise wrapper — we keep
 * the XHR object in a ref so `cancel(localId)` can abort it mid-flight.
 *
 * Drift-safe: each render captures the current conversationId and
 * reBootstrapSession from args; performUpload is wrapped in
 * useCallback so the closure is replaced whenever args change.
 */

import { useCallback, useRef, useState } from "react";

import { sanitizeFilename } from "@/features/kos/lib/filename-sanitize";
import {
  isDrawingSourceFormat,
  type DrawingSourceFormat,
} from "@/features/kos/types/drawing";

// Mirror of the server-side cap. The server also enforces this, so a
// client tampering with the constant just gets a 413 from the route.
const MAX_BYTES = 15 * 1024 * 1024;

const ALLOWED_EXT = [
  ".dxf",
  ".dwg",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
] as const;

export type AttachmentPhase = "queued" | "uploading" | "uploaded" | "failed";

export interface AttachmentState {
  localId: string;
  phase: AttachmentPhase;
  /**
   * Original File ref. Held only on the client to support retry; not
   * sent through the network past the XHR PUT. Garbage-collected when
   * the attachment leaves the array via `clear()` or `cancel()`.
   */
  file?: File;
  drawingId?: string;
  /** Sanitized filename — the one persisted to S3 + DB. */
  filename: string;
  /** User-supplied filename, preserved for display only. */
  originalFilename: string;
  /** Client-asserted size at addFile time; server may update to actualSizeBytes on confirm. */
  sizeBytes: number;
  sourceFormat?: DrawingSourceFormat;
  /** 0-100 progress percentage during the XHR PUT step. */
  progress?: number;
  errorCode?: string;
  errorText?: string;
  canRetry?: boolean;
}

export interface AttachmentRef {
  drawingId: string;
  kind: "drawing";
}

export interface UseChatAttachmentsArgs {
  /** Current conversation id, or null if no conversation has started yet. */
  conversationId: string | null;
  /** Re-bootstrap the customer session cookie (used on 401 retry). */
  reBootstrapSession: () => Promise<unknown>;
}

export interface UseChatAttachmentsReturn {
  attachments: AttachmentState[];
  pendingAttachments: AttachmentState[];
  hasInFlight: boolean;
  addFile: (file: File) => Promise<void>;
  retry: (localId: string) => Promise<void>;
  cancel: (localId: string) => void;
  clear: () => void;
  drainPending: () => AttachmentRef[];
}

function inferSourceFormat(filename: string): DrawingSourceFormat | undefined {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext) return undefined;
  const stripped = ext.slice(1);
  return isDrawingSourceFormat(stripped) ? stripped : undefined;
}

function inferContentType(sourceFormat: DrawingSourceFormat): string {
  switch (sourceFormat) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "dxf":
      return "application/dxf";
    case "dwg":
      return "application/acad";
  }
}

function validateLocal(
  file: File,
): { ok: true } | { ok: false; code: string; text: string } {
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext || !ALLOWED_EXT.includes(ext as (typeof ALLOWED_EXT)[number])) {
    return {
      ok: false,
      code: "KOS_DRAW_001",
      text: `Unsupported file type. Supported: ${ALLOWED_EXT.join(", ")}.`,
    };
  }
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      code: "KOS_DRAW_002",
      text: `File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB. Limit: 15 MB.`,
    };
  }
  if (file.size === 0) {
    return {
      ok: false,
      code: "KOS_DRAW_003",
      text: "File is empty.",
    };
  }
  return { ok: true };
}

function newLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `att_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function useChatAttachments(
  args: UseChatAttachmentsArgs,
): UseChatAttachmentsReturn {
  const [attachments, setAttachments] = useState<AttachmentState[]>([]);
  const xhrMap = useRef<Map<string, XMLHttpRequest>>(new Map());

  const update = useCallback(
    (localId: string, patch: Partial<AttachmentState>) => {
      setAttachments((prev) =>
        prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)),
      );
    },
    [],
  );

  const performUpload = useCallback(
    async (state: AttachmentState): Promise<void> => {
      const localId = state.localId;
      const file = state.file;
      if (!file || !state.sourceFormat) {
        update(localId, {
          phase: "failed",
          errorCode: "KOS_DRAW_001",
          errorText: "Invalid attachment state.",
          canRetry: false,
        });
        return;
      }

      const presignBody = {
        filename: state.filename,
        originalFilename: state.originalFilename,
        contentType: inferContentType(state.sourceFormat),
        sizeBytes: state.sizeBytes,
        sourceFormat: state.sourceFormat,
        conversationId: args.conversationId,
      };

      // ── Step 1: presign ────────────────────────────────────────
      let presignRes: Response;
      try {
        presignRes = await fetch("/api/kos/customer/drawings/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(presignBody),
          credentials: "include",
        });
      } catch {
        update(localId, {
          phase: "failed",
          errorCode: "KOS_DRAW_NET_001",
          errorText: "Network error. Check your connection.",
          canRetry: true,
        });
        return;
      }

      // One-shot 401 recovery — re-mint the session cookie and retry.
      if (presignRes.status === 401) {
        try {
          await args.reBootstrapSession();
        } catch {
          update(localId, {
            phase: "failed",
            errorCode: "KOS_DRAW_AUTH_001",
            errorText: "Session expired. Refresh the page and try again.",
            canRetry: false,
          });
          return;
        }
        try {
          presignRes = await fetch("/api/kos/customer/drawings/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(presignBody),
            credentials: "include",
          });
        } catch {
          update(localId, {
            phase: "failed",
            errorCode: "KOS_DRAW_NET_001",
            errorText: "Network error after session refresh.",
            canRetry: true,
          });
          return;
        }
      }

      if (!presignRes.ok) {
        let code = "KOS_DRAW_UP_500";
        let text = "Upload could not be started.";
        try {
          const body = await presignRes.json();
          if (typeof body.code === "string") code = body.code;
          if (typeof body.message === "string") text = body.message;
        } catch {
          /* non-JSON error body */
        }
        update(localId, {
          phase: "failed",
          errorCode: code,
          errorText: text,
          canRetry: presignRes.status >= 500,
        });
        return;
      }

      let presignJson: { drawingId: string; uploadUrl: string };
      try {
        presignJson = await presignRes.json();
      } catch {
        update(localId, {
          phase: "failed",
          errorCode: "KOS_DRAW_UP_PARSE_001",
          errorText: "Server returned an unexpected response.",
          canRetry: true,
        });
        return;
      }

      const { drawingId, uploadUrl } = presignJson;
      if (!drawingId || !uploadUrl) {
        update(localId, {
          phase: "failed",
          errorCode: "KOS_DRAW_UP_PARSE_002",
          errorText: "Server response missing drawingId or uploadUrl.",
          canRetry: true,
        });
        return;
      }

      update(localId, { phase: "uploading", drawingId, progress: 0 });

      // ── Step 2: XHR PUT (for upload progress events) ───────────
      const putOk = await new Promise<boolean>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhrMap.current.set(localId, xhr);
        xhr.open("PUT", uploadUrl, true);
        xhr.setRequestHeader(
          "Content-Type",
          inferContentType(state.sourceFormat as DrawingSourceFormat),
        );
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) {
            const pct = Math.min(
              100,
              Math.max(0, Math.round((e.loaded / e.total) * 100)),
            );
            update(localId, { progress: pct });
          }
        };
        xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
        xhr.onerror = () => resolve(false);
        xhr.onabort = () => resolve(false);
        xhr.ontimeout = () => resolve(false);
        xhr.send(file);
      });
      xhrMap.current.delete(localId);

      if (!putOk) {
        update(localId, {
          phase: "failed",
          errorCode: "KOS_DRAW_PUT_001",
          errorText: "Upload to storage failed. Tap retry.",
          canRetry: true,
        });
        return;
      }

      // ── Step 3: confirm-upload ────────────────────────────────
      try {
        const confirmRes = await fetch(
          `/api/kos/customer/drawings/${encodeURIComponent(drawingId)}/confirm-upload`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
          },
        );
        if (!confirmRes.ok) {
          let code = "KOS_DRAW_CFM_500";
          let text = "Could not confirm the upload.";
          try {
            const body = await confirmRes.json();
            if (typeof body.code === "string") code = body.code;
            if (typeof body.message === "string") text = body.message;
          } catch {
            /* non-JSON */
          }
          update(localId, {
            phase: "failed",
            errorCode: code,
            errorText: text,
            canRetry: confirmRes.status >= 500,
          });
          return;
        }
        const data = (await confirmRes.json()) as {
          drawing: { sizeBytes: number };
        };
        update(localId, {
          phase: "uploaded",
          sizeBytes: data.drawing.sizeBytes,
          progress: 100,
        });
      } catch {
        update(localId, {
          phase: "failed",
          errorCode: "KOS_DRAW_CFM_NET_001",
          errorText: "Network error confirming the upload.",
          canRetry: true,
        });
      }
    },
    [args, update],
  );

  const addFile = useCallback(
    async (file: File): Promise<void> => {
      const localId = newLocalId();

      const validation = validateLocal(file);
      if (!validation.ok) {
        setAttachments((prev) => [
          ...prev,
          {
            localId,
            phase: "failed",
            filename: file.name,
            originalFilename: file.name,
            sizeBytes: file.size,
            errorCode: validation.code,
            errorText: validation.text,
            canRetry: false,
          },
        ]);
        return;
      }

      const sourceFormat = inferSourceFormat(file.name);
      if (!sourceFormat) {
        setAttachments((prev) => [
          ...prev,
          {
            localId,
            phase: "failed",
            filename: file.name,
            originalFilename: file.name,
            sizeBytes: file.size,
            errorCode: "KOS_DRAW_001",
            errorText: "Could not determine file format from the extension.",
            canRetry: false,
          },
        ]);
        return;
      }

      const filename = sanitizeFilename(file.name);
      const newState: AttachmentState = {
        localId,
        phase: "queued",
        file,
        filename,
        originalFilename: file.name,
        sizeBytes: file.size,
        sourceFormat,
      };
      setAttachments((prev) => [...prev, newState]);
      await performUpload(newState);
    },
    [performUpload],
  );

  const retry = useCallback(
    async (localId: string): Promise<void> => {
      // Read the latest state via closure (attachments is captured at
      // render time and is up-to-date because retry's identity is
      // recomputed whenever attachments change). Reading via a
      // `setAttachments(prev => ...)` callback is unreliable here
      // because React batches updaters and the read may race the
      // subsequent `if (!current)` check.
      const current = attachments.find((a) => a.localId === localId);
      if (!current || !current.file) {
        update(localId, {
          canRetry: false,
          errorText: "File no longer available — please re-upload.",
        });
        return;
      }
      update(localId, {
        phase: "queued",
        errorCode: undefined,
        errorText: undefined,
        progress: undefined,
      });
      await performUpload({ ...current, phase: "queued" });
    },
    [attachments, performUpload, update],
  );

  const cancel = useCallback((localId: string): void => {
    const xhr = xhrMap.current.get(localId);
    if (xhr) {
      try {
        xhr.abort();
      } catch {
        /* abort can throw if the request is already done */
      }
      xhrMap.current.delete(localId);
    }
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));
  }, []);

  const clear = useCallback((): void => {
    // Only remove uploaded entries — in-flight + failed entries stay
    // so the customer doesn't lose state on a sendMessage call.
    setAttachments((prev) => prev.filter((a) => a.phase !== "uploaded"));
  }, []);

  const drainPending = useCallback((): AttachmentRef[] => {
    return attachments
      .filter((a) => a.phase === "uploaded" && a.drawingId)
      .map((a) => ({ drawingId: a.drawingId!, kind: "drawing" as const }));
  }, [attachments]);

  const pendingAttachments = attachments.filter((a) => a.phase === "uploaded");
  const hasInFlight = attachments.some(
    (a) => a.phase === "uploading" || a.phase === "queued",
  );

  return {
    attachments,
    pendingAttachments,
    hasInFlight,
    addFile,
    retry,
    cancel,
    clear,
    drainPending,
  };
}
