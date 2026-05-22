"use client";

/**
 * Document upload modal — 3-step flow:
 *   1. POST /api/kos/bd/documents/upload-url  →  documentId + presigned URL
 *   2. PUT the file directly to the presigned URL (with Content-Type)
 *   3. POST /api/kos/bd/documents/[id]/confirm-upload
 *
 * Progress UI: shows percent during step 2 (XHR for upload progress
 * events; `fetch` cannot stream progress yet in any browser), then a
 * "Parsing…" status while the worker is presumed to run.
 *
 * On success, hard-refreshes the page so the server-rendered table
 * re-fetches from Prisma (no client cache to invalidate). Crude but
 * correct — Week 3 may swap this for a TanStack-Query feed.
 */

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const DOC_TYPES = [
  "PAC",
  "CERTIFICATE",
  "CASE_STUDY",
  "PRICING",
  "COMPARISON",
  "FAQ",
  "WARRANTY",
  "OTHER",
] as const;

type Phase = "idle" | "creating" | "uploading" | "confirming" | "done";

export default function UploadModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]>("CASE_STUDY");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setDocType("CASE_STUDY");
    setPhase("idle");
    setProgress(0);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit() {
    if (!file) return;
    setError(null);
    setPhase("creating");
    setProgress(0);

    try {
      // ── Step 1: ask the server for a presigned URL ──
      const createRes = await fetch("/api/kos/bd/documents/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/pdf",
          sizeBytes: file.size,
          docType,
        }),
        credentials: "same-origin",
      });
      const created = (await safeJson(createRes)) as
        | {
            documentId?: string;
            uploadUrl?: string;
            error?: { code?: string; message?: string };
          }
        | null;
      if (!createRes.ok || !created?.documentId || !created.uploadUrl) {
        const msg =
          created?.error?.message ??
          `Failed to create upload (HTTP ${createRes.status}).`;
        throw new Error(msg);
      }
      const { documentId, uploadUrl } = created;

      // ── Step 2: PUT to S3 directly with progress events ──
      setPhase("uploading");
      await putFileWithProgress(uploadUrl, file, (p) => setProgress(p));

      // ── Step 3: tell the server the upload succeeded ──
      setPhase("confirming");
      const confirmRes = await fetch(
        `/api/kos/bd/documents/${documentId}/confirm-upload`,
        { method: "POST", credentials: "same-origin" },
      );
      const confirmed = (await safeJson(confirmRes)) as
        | { error?: { message?: string } }
        | null;
      if (!confirmRes.ok) {
        const msg =
          confirmed?.error?.message ??
          `Failed to confirm upload (HTTP ${confirmRes.status}).`;
        throw new Error(msg);
      }

      setPhase("done");
      toast.success("Document uploaded — parsing started.");
      router.refresh();
      // Small delay so the toast is visible before the modal closes.
      setTimeout(() => {
        setOpen(false);
        reset();
      }, 400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed.";
      setError(msg);
      toast.error(msg);
      setPhase("idle");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: "9px 16px",
          borderRadius: 10,
          border: "none",
          background: "var(--kos-secondary, #c9a55a)",
          color: "var(--kos-primary, #0a3d2e)",
          fontWeight: 700,
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        Upload document
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Upload document"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && phase === "idle") {
              setOpen(false);
              reset();
            }
          }}
        >
          <div
            style={{
              background: "#0d0d10",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: 28,
              width: "100%",
              maxWidth: 480,
              color: "#fafafa",
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
              Upload document
            </h2>
            <p style={{ fontSize: 12, opacity: 0.65, marginBottom: 18 }}>
              PDF only, up to 50 MB. Once uploaded, the system parses, chunks,
              and embeds the document for retrieval.
            </p>

            <label
              style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}
            >
              Document type
            </label>
            <select
              value={docType}
              onChange={(e) =>
                setDocType(e.target.value as (typeof DOC_TYPES)[number])
              }
              disabled={phase !== "idle"}
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: 8,
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#fafafa",
                fontSize: 13,
                marginBottom: 14,
              }}
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <label
              style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}
            >
              File
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              disabled={phase !== "idle"}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{
                width: "100%",
                marginBottom: 14,
                fontSize: 13,
                color: "#fafafa",
              }}
            />

            {file && (
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </div>
            )}

            {phase === "uploading" && (
              <div style={{ marginBottom: 12 }}>
                <div
                  style={{
                    height: 8,
                    borderRadius: 4,
                    background: "rgba(255,255,255,0.08)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${progress}%`,
                      background: "var(--kos-secondary, #c9a55a)",
                      transition: "width 80ms ease",
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>
                  Uploading… {progress}%
                </div>
              </div>
            )}

            {phase === "confirming" && (
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
                Confirming upload…
              </div>
            )}

            {phase === "done" && (
              <div style={{ fontSize: 12, color: "#86efac", marginBottom: 12 }}>
                Uploaded. Worker dispatched — status will flip to{" "}
                <strong>READY</strong> when embedding completes.
              </div>
            )}

            {error && (
              <div
                role="alert"
                style={{
                  fontSize: 12,
                  color: "#fca5a5",
                  background: "rgba(220,38,38,0.08)",
                  border: "1px solid rgba(220,38,38,0.25)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  marginBottom: 12,
                }}
              >
                {error}
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                marginTop: 18,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                disabled={phase !== "idle"}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "#fafafa",
                  fontSize: 13,
                  cursor: phase !== "idle" ? "not-allowed" : "pointer",
                  opacity: phase !== "idle" ? 0.5 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!file || phase !== "idle"}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: "var(--kos-secondary, #c9a55a)",
                  color: "var(--kos-primary, #0a3d2e)",
                  border: "none",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: !file || phase !== "idle" ? "not-allowed" : "pointer",
                  opacity: !file || phase !== "idle" ? 0.5 : 1,
                }}
              >
                Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function putFileWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/pdf");
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else
        reject(
          new Error(
            `S3 upload failed (HTTP ${xhr.status}): ${xhr.responseText?.slice(0, 200) ?? "(no body)"}`,
          ),
        );
    };
    xhr.onerror = () =>
      reject(new Error("Network error during S3 upload (XHR onerror)."));
    xhr.ontimeout = () => reject(new Error("S3 upload timed out."));
    xhr.send(file);
  });
}
