"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X, Loader2, Download, CheckCircle2, AlertTriangle, RotateCcw } from "lucide-react";
import { UI } from "@/features/ifc/components/constants";

export interface EnhanceStats {
  originalBytes: number;
  modifiedBytes: number;
}

export interface OperationSummary {
  op: string;
  ok: boolean;
  message: string;
  entitiesAdded?: number;
  entitiesRewritten?: number;
}

export interface EnhanceSuccess {
  filename: string;
  summary: string;
  understood: string;
  notes: string;
  plannerSource: "ai" | "heuristic";
  results: OperationSummary[];
  stats: EnhanceStats;
  modifiedBuffer: ArrayBuffer;
}

interface IFCEnhancerModalProps {
  open: boolean;
  onClose: () => void;
  sourceFile: { name: string; buffer: ArrayBuffer } | null;
  onApplyToViewer: (result: EnhanceSuccess) => void;
}

const EXAMPLES = [
  "Add one more floor",
  "I want only 3 floors",
  "Add a room on the terrace",
  "Remove the top floor",
];

export function IFCEnhancerModal(props: IFCEnhancerModalProps) {
  // Remount on open/close so local state resets cleanly — avoids a useEffect
  // that would have to call setState to clear fields.
  return props.open ? <ModalBody key="open" {...props} /> : null;
}

function ModalBody({ onClose, sourceFile, onApplyToViewer }: IFCEnhancerModalProps) {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [result, setResult] = useState<EnhanceSuccess | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = setTimeout(() => textareaRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleApply = useCallback(async () => {
    if (!sourceFile) {
      setErrorMessage("No IFC file is loaded in the viewer.");
      setStatus("error");
      return;
    }
    if (!prompt.trim()) {
      setErrorMessage("Please describe what you want to change.");
      setStatus("error");
      return;
    }
    setStatus("working");
    setErrorMessage("");

    try {
      const fd = new FormData();
      fd.append("file", new Blob([sourceFile.buffer], { type: "application/octet-stream" }), sourceFile.name);
      fd.append("prompt", prompt.trim());

      const res = await fetch("/api/enhance-ifc", { method: "POST", body: fd });
      const data = await res.json();

      // Build a result object whether the API succeeded fully, partially, or
      // not at all — so the UI can always show what was understood and what
      // was tried. Status decides whether a download button is offered.
      const modifiedText: string | undefined = typeof data?.modifiedText === "string" ? data.modifiedText : undefined;
      const modifiedBuffer = modifiedText ? new TextEncoder().encode(modifiedText).buffer : sourceFile.buffer.slice(0);

      const built: EnhanceSuccess = {
        filename: data?.filename ?? "model_enhanced.ifc",
        summary: data?.summary ?? data?.message ?? data?.error?.message ?? "",
        understood: data?.understood ?? "",
        notes: data?.notes ?? "",
        plannerSource: data?.plannerSource ?? "heuristic",
        results: Array.isArray(data?.results) ? data.results : [],
        stats: data?.stats ?? { originalBytes: sourceFile.buffer.byteLength, modifiedBytes: modifiedBuffer.byteLength },
        modifiedBuffer,
      };

      if (!res.ok || !data?.ok) {
        // Even on failure we keep the result so the diagnostic UI shows the
        // AI's interpretation + each operation's outcome.
        setResult(built);
        setErrorMessage(
          data?.error?.message ??
            built.summary ??
            built.understood ??
            `Request failed (HTTP ${res.status}).`,
        );
        setStatus("error");
        return;
      }

      setResult(built);
      setStatus("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Unexpected error");
      setStatus("error");
    }
  }, [prompt, sourceFile]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const blob = new Blob([result.modifiedBuffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [result]);

  const handleLoadInViewer = useCallback(() => {
    if (!result) return;
    onApplyToViewer(result);
    onClose();
  }, [result, onApplyToViewer, onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4,5,10,0.72)",
        backdropFilter: "blur(4px)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ifc-enhancer-title"
        style={{
          width: "min(560px, 100%)",
          background: "linear-gradient(180deg, rgba(24,26,42,0.98) 0%, rgba(14,15,26,0.98) 100%)",
          border: "1px solid rgba(79,138,255,0.2)",
          borderRadius: UI.radius.lg,
          boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
          color: UI.text.primary,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            background: "linear-gradient(90deg, rgba(0,245,255,0.06), rgba(79,138,255,0.06))",
          }}
        >
          <Sparkles size={18} color={UI.accent.cyan} />
          <h2 id="ifc-enhancer-title" style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: 0.2, flex: 1 }}>
            IFC Enhancer
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: UI.text.secondary,
              cursor: "pointer",
              padding: 4,
              borderRadius: 6,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = UI.text.primary; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = UI.text.secondary; e.currentTarget.style.background = "transparent"; }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18 }}>
          {status !== "success" && (
            <>
              <label
                htmlFor="ifc-enhancer-prompt"
                style={{ display: "block", fontSize: 12, color: UI.text.secondary, marginBottom: 8 }}
              >
                Describe the change you want to apply to{" "}
                <span style={{ color: UI.text.primary, fontWeight: 500 }}>
                  {sourceFile?.name || "the loaded IFC"}
                </span>
              </label>
              <textarea
                id="ifc-enhancer-prompt"
                ref={textareaRef}
                value={prompt}
                disabled={status === "working"}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleApply();
                  }
                }}
                placeholder="e.g. I want only 3 floors and on terrace I want one room"
                rows={4}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "rgba(7,7,13,0.6)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: UI.radius.md,
                  color: UI.text.primary,
                  padding: "10px 12px",
                  fontSize: 13,
                  lineHeight: 1.45,
                  resize: "vertical",
                  outline: "none",
                  fontFamily: "inherit",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = UI.border.focus; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
              />

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    disabled={status === "working"}
                    onClick={() => setPrompt(ex)}
                    style={{
                      fontSize: 11,
                      padding: "5px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.03)",
                      color: UI.text.secondary,
                      cursor: "pointer",
                      transition: UI.transition,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "rgba(79,138,255,0.45)";
                      e.currentTarget.style.color = UI.text.primary;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                      e.currentTarget.style.color = UI.text.secondary;
                    }}
                  >
                    {ex}
                  </button>
                ))}
              </div>

              {status === "error" && (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      padding: "8px 10px",
                      background: "rgba(248,113,113,0.08)",
                      border: "1px solid rgba(248,113,113,0.3)",
                      borderRadius: UI.radius.md,
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      fontSize: 12,
                      color: "#FCA5A5",
                    }}
                  >
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ whiteSpace: "pre-wrap" }}>{errorMessage}</span>
                  </div>

                  {result?.understood && (
                    <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(0,245,255,0.05)", border: "1px solid rgba(0,245,255,0.18)", borderRadius: UI.radius.md }}>
                      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6, color: UI.accent.cyan, marginBottom: 3, fontWeight: 600 }}>
                        {result.plannerSource === "ai" ? "AI Understood" : "Interpreted"}
                      </div>
                      <div style={{ fontSize: 12, color: UI.text.primary, lineHeight: 1.5 }}>{result.understood}</div>
                    </div>
                  )}

                  {result && result.results.length > 0 && (
                    <ol style={{ marginTop: 10, paddingLeft: 0, listStyle: "none" }}>
                      {result.results.map((r, i) => (
                        <li
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            padding: "6px 10px",
                            borderRadius: UI.radius.sm,
                            background: r.ok ? "rgba(52,211,153,0.06)" : "rgba(248,113,113,0.06)",
                            border: `1px solid ${r.ok ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
                            marginBottom: 4,
                          }}
                        >
                          <span style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", color: r.ok ? UI.accent.green : "#FCA5A5", width: 14, flexShrink: 0 }}>
                            {r.ok ? "✓" : "×"}
                          </span>
                          <span style={{ fontSize: 11, flex: 1, color: UI.text.secondary }}>
                            <code style={{ color: UI.text.primary, fontSize: 11 }}>{r.op}</code>
                            {" — "}{r.message}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}

                  {result?.notes && (
                    <div style={{ marginTop: 8, padding: "6px 10px", fontSize: 11, color: UI.text.tertiary, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: UI.radius.sm }}>
                      Note: {result.notes}
                    </div>
                  )}

                  {result && result.stats.modifiedBytes !== result.stats.originalBytes && (
                    <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={handleDownload}
                        style={{
                          padding: "6px 12px",
                          fontSize: 11,
                          fontWeight: 500,
                          border: "1px solid rgba(255,255,255,0.15)",
                          background: "rgba(255,255,255,0.05)",
                          color: UI.text.primary,
                          borderRadius: UI.radius.md,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Download size={11} /> Download partial result
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={status === "working"}
                  style={{
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 500,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "transparent",
                    color: UI.text.secondary,
                    borderRadius: UI.radius.md,
                    cursor: status === "working" ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={status === "working" || !prompt.trim() || !sourceFile}
                  style={{
                    padding: "8px 16px",
                    fontSize: 12,
                    fontWeight: 600,
                    border: "1px solid rgba(0,245,255,0.5)",
                    background: "linear-gradient(90deg, #00F5FF 0%, #4F8AFF 100%)",
                    color: "#07070D",
                    borderRadius: UI.radius.md,
                    cursor: status === "working" || !prompt.trim() || !sourceFile ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    opacity: status === "working" || !prompt.trim() || !sourceFile ? 0.55 : 1,
                    transition: UI.transition,
                  }}
                >
                  {status === "working" ? (
                    <>
                      <Loader2 size={13} style={{ animation: "ifc-enh-spin 0.8s linear infinite" }} />
                      Applying…
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} />
                      Apply enhancement
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {status === "success" && result && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 12px",
                  background: "rgba(52,211,153,0.08)",
                  border: "1px solid rgba(52,211,153,0.35)",
                  borderRadius: UI.radius.md,
                }}
              >
                <CheckCircle2 size={16} color={UI.accent.green} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12.5, lineHeight: 1.5, color: UI.text.primary, flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Enhancement applied</div>
                  <div style={{ color: UI.text.secondary }}>{result.summary}</div>
                </div>
              </div>

              {result.understood && (
                <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(0,245,255,0.05)", border: "1px solid rgba(0,245,255,0.18)", borderRadius: UI.radius.md }}>
                  <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6, color: UI.accent.cyan, marginBottom: 3, fontWeight: 600 }}>
                    {result.plannerSource === "ai" ? "AI Understood" : "Interpreted"}
                  </div>
                  <div style={{ fontSize: 12, color: UI.text.primary, lineHeight: 1.5 }}>{result.understood}</div>
                </div>
              )}

              {result.results.length > 0 && (
                <ol style={{ marginTop: 10, paddingLeft: 0, listStyle: "none" }}>
                  {result.results.map((r, i) => (
                    <li
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: "6px 10px",
                        borderRadius: UI.radius.sm,
                        background: r.ok ? "rgba(255,255,255,0.02)" : "rgba(248,113,113,0.06)",
                        border: `1px solid ${r.ok ? "rgba(255,255,255,0.06)" : "rgba(248,113,113,0.2)"}`,
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: "ui-monospace, monospace",
                          color: r.ok ? UI.accent.green : "#FCA5A5",
                          width: 14,
                          flexShrink: 0,
                        }}
                      >{r.ok ? "✓" : "×"}</span>
                      <span style={{ fontSize: 11, flex: 1, color: UI.text.secondary }}>
                        <code style={{ color: UI.text.primary, fontSize: 11 }}>{r.op}</code>
                        {" — "}{r.message}
                        {r.entitiesAdded ? <span style={{ marginLeft: 6, color: UI.text.tertiary }}>(+{r.entitiesAdded})</span> : null}
                        {r.entitiesRewritten ? <span style={{ marginLeft: 6, color: UI.text.tertiary }}>(×{r.entitiesRewritten})</span> : null}
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {result.notes && (
                <div style={{ marginTop: 8, padding: "6px 10px", fontSize: 11, color: UI.text.tertiary, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: UI.radius.sm }}>
                  Note: {result.notes}
                </div>
              )}

              <div style={{ marginTop: 10, fontSize: 11, color: UI.text.tertiary, textAlign: "right" }}>
                {(result.stats.modifiedBytes / 1024).toFixed(1)} KB · Δ {((result.stats.modifiedBytes - result.stats.originalBytes) / 1024).toFixed(1)} KB
              </div>

              <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => {
                    setStatus("idle");
                    setResult(null);
                    setPrompt("");
                  }}
                  style={{
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 500,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "transparent",
                    color: UI.text.secondary,
                    borderRadius: UI.radius.md,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <RotateCcw size={12} /> Another change
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  style={{
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.05)",
                    color: UI.text.primary,
                    borderRadius: UI.radius.md,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Download size={12} /> Download modified IFC
                </button>
                <button
                  type="button"
                  onClick={handleLoadInViewer}
                  style={{
                    padding: "8px 16px",
                    fontSize: 12,
                    fontWeight: 600,
                    border: "1px solid rgba(0,245,255,0.5)",
                    background: "linear-gradient(90deg, #00F5FF 0%, #4F8AFF 100%)",
                    color: "#07070D",
                    borderRadius: UI.radius.md,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Sparkles size={12} /> Update viewer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes ifc-enh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
