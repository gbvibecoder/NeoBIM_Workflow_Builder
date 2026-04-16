"use client";

/**
 * Interactive input node shell + per-type input components.
 * All interactive elements use nodrag/nowheel/nopan class + stopPropagation
 * so React Flow doesn't interfere with typing/clicking.
 */

import React, { useRef, useCallback, useMemo, useState, useEffect, memo } from "react";
import { toast } from "sonner";
import { useWorkflowStore } from "@/features/workflows/stores/workflow-store";
import { useLocale } from "@/hooks/useLocale";
import type { WorkflowNodeData } from "@/types/nodes";
import { formatBytes } from "@/lib/utils";
import { nodeText } from "@/features/canvas/components/nodes/node-text-styles";

// ─── File store (module-level, not in Zustand — files can't serialize) ───────
export const inputFileStore = new Map<string, File>();
export const inputMultiFileStore = new Map<string, File[]>();

// ─── Shared stop-propagation handler ─────────────────────────────────────────
function stopAll(e: React.SyntheticEvent) {
  e.stopPropagation();
}

// ─── Text Prompt (IN-001) ────────────────────────────────────────────────────

export const TextPromptInput = memo(function TextPromptInput({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  const updateNode = useWorkflowStore(s => s.updateNode);
  const t = useLocale(s => s.t);
  const value = (data.inputValue as string) ?? "";

  const onChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const currentNode = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
    if (!currentNode) return;
    updateNode(nodeId, { data: { ...currentNode.data, inputValue: e.target.value } });
  }, [nodeId, updateNode]);

  const isEmpty = !value.trim();

  return (
    <div className="nodrag nowheel nopan" onMouseDown={stopAll} onClick={stopAll} onKeyDown={stopAll}>
      <textarea
        value={value}
        onChange={onChange}
        placeholder={t('input.describePlaceholder')}
        rows={3}
        style={{
          width: "100%", resize: "none", boxSizing: "border-box",
          marginTop: 8, padding: "12px",
          background: isEmpty ? "rgba(0,245,255,0.04)" : "rgba(0,0,0,0.3)",
          borderRadius: 4,
          border: isEmpty
            ? "1px solid rgba(0,245,255,0.3)"
            : "1px solid rgba(255,255,255,0.08)",
          color: "#F0F0F5", fontSize: 13, lineHeight: 1.5,
          fontFamily: "inherit", outline: "none",
          animation: isEmpty ? "pulseInputBorder 2s ease-in-out infinite" : "none",
          transition: "all 150ms ease",
        }}
      />
      <div style={{
        ...nodeText.meta,
        textAlign: "right", marginTop: 4,
      }}>
        {value.length} / 2000
      </div>
    </div>
  );
});

// ─── File Upload (PDF, IFC, Image, DXF) ─────────────────────────────────────

interface FileUploadProps {
  nodeId: string;
  data: WorkflowNodeData;
  accept: string;
  label: string;
  maxMB?: number;
  showPreview?: boolean;
}

export const FileUploadInput = memo(function FileUploadInput({ nodeId, data, accept, label, maxMB = 20, showPreview }: FileUploadProps) {
  const updateNode = useWorkflowStore(s => s.updateNode);
  const t = useLocale(s => s.t);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileName = data.inputValue as string | undefined;
  const hasFile = !!fileName;
  const autoAttachedRef = useRef(false);

  const handleFile = useCallback(async (file: File) => {
    if (maxMB && file.size > maxMB * 1024 * 1024) {
      toast.error(`${t('input.fileTooLarge')} ${maxMB}MB.`);
      return;
    }
    // Validate file extension matches the accepted types
    if (accept) {
      const allowedExts = accept.split(",").map(e => e.trim().toLowerCase());
      const fileExt = "." + file.name.split(".").pop()?.toLowerCase();
      if (!allowedExts.includes(fileExt)) {
        const isIfc = allowedExts.includes(".ifc");
        toast.error(
          isIfc
            ? "This file is not an IFC file"
            : `Unsupported file type`,
          {
            description: isIfc
              ? `You uploaded "${file.name}" — this workflow requires a Building Information Model (.ifc) file exported from BIM software like Revit, ArchiCAD, or Tekla. Please upload a valid .ifc file to continue.`
              : `"${file.name}" is not supported here. Please upload a ${allowedExts.map(e => e.replace(".", ".").toUpperCase()).join(" or ")} file.`,
            duration: 8000,
          }
        );
        return;
      }
    }
    inputFileStore.set(nodeId, file);
    const currentNode = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
    if (!currentNode) return;

    // IFC files: parse in the browser using lightweight text parser — no server upload needed.
    // This avoids Vercel's 4.5MB body limit entirely.
    const isIFCFile = file.name.toLowerCase().endsWith(".ifc");

    if (isIFCFile) {
      updateNode(nodeId, { data: { ...currentNode.data, inputValue: file.name, fileSize: file.size, fileName: file.name, mimeType: file.type } });
      const sizeLabel = formatBytes(file.size, 1);
      toast.loading(`Reading IFC file (${sizeLabel})…`, { id: `ifc-parse-${nodeId}` });

      // ── Pure client-side text parser (no upload, any file size) ───────
      // The text parser scans the raw IFC STEP text and now produces a
      // ParserDiagnosticCounters payload (geometry-type counts, material
      // associations, Qto presence, smart warnings, fixes, sample elements
      // with fallback chains) — same shape as the WASM parser's output, so
      // the "Behind the Scenes" panel renders identically. No R2 upload, no
      // Vercel body cap, no CORS — just file.text() + regex scanning.
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          toast.loading("Parsing IFC + extracting diagnostics…", { id: `ifc-parse-${nodeId}` });
          const text = reader.result as string;
          const { parseIFCText } = await import("@/features/ifc/services/ifc-text-parser");
          const result = parseIFCText(text);

          const node = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
          if (!node) return;

          const hasDiag = !!result.parserDiagnostics;
          const fm = result.parserDiagnostics?.fileMetadata as Record<string, unknown> | undefined;
          const sw = result.parserDiagnostics?.smartWarnings ?? [];
          // Single grep target — search browser console for `[BOQ-PARSE]`.
          console.info(
            `[BOQ-PARSE] file=${file.name} size=${file.size}B parser=text hasParserDiagnostics=${hasDiag} ` +
            `qto=${fm?.qtoBaseSetCount ?? 0} extrusions=${(result.parserDiagnostics?.geometryTypes.extrudedAreaSolid ?? 0)} ` +
            `facetedBrep=${(result.parserDiagnostics?.geometryTypes.facetedBrep ?? 0)} ` +
            `booleanResult=${(result.parserDiagnostics?.geometryTypes.booleanResult ?? 0)} ` +
            `samples=${(result.parserDiagnostics?.elementSamples ?? []).length} smartWarnings=${sw.length}`
          );
          if (sw.length > 0) {
            for (const w of sw) console.info(`[BOQ-PARSE]   ${w}`);
          }

          updateNode(nodeId, {
            data: {
              ...node.data,
              inputValue: file.name,
              fileSize: file.size,
              fileName: file.name,
              mimeType: file.type,
              ifcParsed: result, // includes parserDiagnostics
              fileData: undefined,
              ifcUrl: undefined,
            },
          });

          toast.success(
            `IFC parsed: ${result.summary.totalElements} elements, ${result.summary.buildingStoreys} storeys${hasDiag ? " (with diagnostics)" : ""}`,
            { id: `ifc-parse-${nodeId}`, duration: 5000 }
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Parse failed";
          toast.error("Could not parse this IFC file", {
            id: `ifc-parse-${nodeId}`,
            description: "The file may be corrupted or in an unsupported format. Try re-exporting from your BIM software.",
            duration: 8000,
          });
          console.warn("[IFC Parse] Technical error:", msg);
        }
      };
      reader.onerror = () => {
        toast.error("Failed to read IFC file", { id: `ifc-parse-${nodeId}` });
      };
      reader.readAsText(file);
    } else {
      // Small files / non-IFC: convert to base64 for inline transport
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1]; // strip data:...;base64, prefix
        const node = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
        if (!node) return;
        updateNode(nodeId, {
          data: { ...node.data, inputValue: file.name, fileSize: file.size, fileData: base64, fileName: file.name, mimeType: file.type },
        });
      };
      reader.readAsDataURL(file);

      // Set filename immediately (base64 follows async)
      updateNode(nodeId, { data: { ...currentNode.data, inputValue: file.name, fileSize: file.size } });
    }
  }, [nodeId, updateNode, maxMB, t]);

  /* Auto-attach the file the user is viewing in the IFC Viewer (bridged via
     the shared IndexedDB cache). This effect lives in the node itself so we
     don't have to race with template-load / React Flow mount timing from
     the parent canvas — by the time this fires, this specific IFC Upload
     input is already mounted in the DOM. The cross-tab handoff works
     because IndexedDB is same-origin shared between the viewer tab and the
     canvas tab opened by the banner's `window.open`. */
  useEffect(() => {
    if (autoAttachedRef.current) return;
    if (accept !== ".ifc") return;
    autoAttachedRef.current = true;

    const params = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
    const force = params.get("autoAttachIFC") === "1";

    void (async () => {
      /* Give React one commit so the node's initial render settles before
         we mutate its data from the same effect. */
      await new Promise((r) => setTimeout(r, 50));

      const latest = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
      if (!latest) return;
      if (!force && latest.data.inputValue) {
        console.info(`[IFC auto-attach] ${nodeId} already has a file — skipping`);
        return;
      }

      try {
        const { loadLastIFCFile } = await import("@/features/ifc/lib/ifc-cache");
        const cached = await loadLastIFCFile();
        if (!cached?.buffer || cached.buffer.byteLength === 0) {
          console.info("[IFC auto-attach] no cached IFC in IndexedDB — skipping");
          return;
        }
        console.info(`[IFC auto-attach] ${nodeId}: attaching ${cached.name} (${cached.buffer.byteLength} bytes)`);
        const file = new File([cached.buffer], cached.name, { type: "application/octet-stream" });
        /* Reuse handleFile verbatim so the drag-drop and auto-attach paths
           write identical state into the store (parse diagnostics, toasts,
           inputFileStore entry, etc.). */
        await handleFile(file);
      } catch (err) {
        console.warn("[IFC auto-attach] failed:", err);
      }
    })();
    // `handleFile`'s identity churns on every locale-function change; we
    // only want to fire once per node mount, so it's intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, accept]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
  }, []);

  const onRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    inputFileStore.delete(nodeId);
    const currentNode = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
    if (!currentNode) return;
    updateNode(nodeId, { data: { ...currentNode.data, inputValue: "", fileSize: undefined, fileData: undefined, fileName: undefined, mimeType: undefined } });
    if (inputRef.current) inputRef.current.value = "";
  }, [nodeId, updateNode]);

  const fileObj = inputFileStore.get(nodeId);
  const isImage = showPreview && fileObj && fileObj.type.startsWith("image/");

  return (
    <div
      className="nodrag nowheel nopan"
      onMouseDown={stopAll} onClick={stopAll} onKeyDown={stopAll}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={onFileChange}
        style={{ display: "none" }}
      />
      {hasFile ? (
        <div style={{
          marginTop: 8, padding: "6px 8px", borderRadius: 6,
          background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)",
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          {isImage && fileObj && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={URL.createObjectURL(fileObj)}
              alt="preview"
              style={{ width: "100%", height: 48, objectFit: "cover", borderRadius: 4, marginBottom: 2 }}
            />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "#10B981", flexShrink: 0,
            }} />
            <span style={{
              fontSize: 11, fontWeight: 500, color: "#34D399", flex: 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              letterSpacing: "0.01em",
            }}>
              {fileName}
            </span>
            <button
              onClick={onRemove}
              style={{
                ...nodeText.helper,
                background: "none",
                border: "none", cursor: "pointer", padding: "0 4px",
              }}
            >
              ✕
            </button>
          </div>
          {(data.fileSize as number | undefined) && (
            <span style={nodeText.meta}>
              {((data.fileSize as number) / 1024).toFixed(1)} KB
            </span>
          )}
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={onDragOver}
          style={{
            marginTop: 8, padding: "10px 8px", borderRadius: 6, cursor: "pointer",
            border: "1px dashed rgba(0,245,255,0.25)",
            background: "rgba(0,245,255,0.03)",
            textAlign: "center",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,245,255,0.5)";
            (e.currentTarget as HTMLElement).style.background = "rgba(0,245,255,0.07)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,245,255,0.25)";
            (e.currentTarget as HTMLElement).style.background = "rgba(0,245,255,0.03)";
          }}
        >
          <div style={nodeText.helper}>
            Drop {label} {t('input.dropHereOr')} <span style={nodeText.hintLink}>{t('input.clickToBrowse')}</span>
          </div>
          <div style={{ ...nodeText.meta, marginTop: 3 }}>
            {accept} · max {maxMB}MB
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Parameter Input (IN-005) ─────────────────────────────────────────────────

interface Params { floors: number; gfa: number; height: number; style: string }

function NumericParamInput({
  value,
  onChange,
  style,
}: {
  value: number;
  onChange: (v: number) => void;
  style: React.CSSProperties;
}) {
  const [localValue, setLocalValue] = useState<string>(String(value));

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  return (
    <input
      type="number"
      value={localValue}
      onChange={e => {
        setLocalValue(e.target.value);
        const parsed = parseFloat(e.target.value);
        if (!isNaN(parsed)) {
          onChange(parsed);
        }
      }}
      onBlur={() => {
        const parsed = parseFloat(localValue);
        if (isNaN(parsed) || localValue.trim() === "") {
          setLocalValue(String(value));
        } else {
          setLocalValue(String(parsed));
          onChange(parsed);
        }
      }}
      style={style}
    />
  );
}

export const ParameterInput = memo(function ParameterInput({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  const updateNode = useWorkflowStore(s => s.updateNode);
  const t = useLocale(s => s.t);

  const STYLE_OPTIONS = useMemo(() => [
    { value: "Modern", label: t('input.styleModern') },
    { value: "Nordic", label: t('input.styleNordic') },
    { value: "Classical", label: t('input.styleClassical') },
    { value: "Industrial", label: t('input.styleIndustrial') },
    { value: "Tropical", label: t('input.styleTropical') },
    { value: "Brutalist", label: t('input.styleBrutalist') },
    { value: "Minimalist", label: t('input.styleMinimalist') },
  ], [t]);

  const params: Params = (() => {
    try {
      const raw = data.inputValue as string | undefined;
      if (!raw) return { floors: 5, gfa: 4800, height: 22, style: "Modern" };
      return JSON.parse(raw) as Params;
    } catch {
      return { floors: 5, gfa: 4800, height: 22, style: "Modern" };
    }
  })();

  const update = useCallback((key: keyof Params, val: string | number) => {
    const currentNode = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
    if (!currentNode) return;
    const currentParams: Params = (() => {
      try {
        const raw = currentNode.data.inputValue as string | undefined;
        if (!raw) return { floors: 5, gfa: 4800, height: 22, style: "Modern" };
        return JSON.parse(raw) as Params;
      } catch { return { floors: 5, gfa: 4800, height: 22, style: "Modern" }; }
    })();
    const next = { ...currentParams, [key]: val };
    updateNode(nodeId, { data: { ...currentNode.data, inputValue: JSON.stringify(next) } });
  }, [nodeId, updateNode]);

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    padding: "6px 12px", borderRadius: 4,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.35)", color: "#F2F4F8",
    fontSize: 13, outline: "none", fontFamily: "inherit",
    transition: "all 150ms ease",
  };

  const rows: Array<{ key: keyof Params; label: string; type: "number" | "select" }> = useMemo(() => [
    { key: "floors", label: t('input.floors'),  type: "number" },
    { key: "gfa",    label: t('input.gfa'),     type: "number" },
    { key: "height", label: t('input.height'),  type: "number" },
    { key: "style",  label: t('input.style'),   type: "select" },
  ], [t]);

  return (
    <div
      className="nodrag nowheel nopan"
      onMouseDown={stopAll} onClick={stopAll} onKeyDown={stopAll}
      style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}
    >
      {rows.map(row => (
        <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ ...nodeText.label, width: 64, flexShrink: 0 }}>
            {row.label}
          </label>
          {row.type === "number" ? (
            <NumericParamInput
              value={params[row.key] as number}
              onChange={v => update(row.key, v)}
              style={inputStyle}
            />
          ) : (
            <select
              value={params[row.key] as string}
              onChange={e => update(row.key, e.target.value)}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              {STYLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </div>
      ))}
    </div>
  );
});

// ─── Supplementary IFC Upload (Build 5: Multi-IFC) ──────────────────────────

// Store for supplementary IFC files (structural, MEP) — keyed by nodeId:type
export const supplementaryIFCStore = new Map<string, { file: File; parsed?: unknown }>();

function SupplementaryIFCUpload({ nodeId }: { nodeId: string }) {
  const updateNode = useWorkflowStore(s => s.updateNode);
  const [structural, setStructural] = useState<string | null>(null);
  const [mep, setMep] = useState<string | null>(null);
  const structRef = useRef<HTMLInputElement>(null);
  const mepRef = useRef<HTMLInputElement>(null);

  const handleSupplementary = useCallback(async (file: File, type: "structural" | "mep") => {
    if (file.size > 100 * 1024 * 1024) { toast.error("File too large (max 100MB)"); return; }
    if (!file.name.toLowerCase().endsWith(".ifc")) { toast.error("Only .ifc files accepted"); return; }

    supplementaryIFCStore.set(`${nodeId}:${type}`, { file });
    if (type === "structural") setStructural(file.name);
    else setMep(file.name);

    toast.loading(`Parsing ${type} IFC...`, { id: `ifc-${type}-${nodeId}` });
    try {
      const text = await file.text();
      const { parseIFCText } = await import("@/features/ifc/services/ifc-text-parser");
      const result = parseIFCText(text);
      supplementaryIFCStore.set(`${nodeId}:${type}`, { file, parsed: result });

      const node = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
      if (node) {
        const key = type === "structural" ? "structuralIFCParsed" : "mepIFCParsed";
        updateNode(nodeId, { data: { ...node.data, [key]: result } });
      }

      toast.success(`${type} IFC: ${result.summary.totalElements} elements`, { id: `ifc-${type}-${nodeId}`, duration: 4000 });
    } catch {
      toast.error(`${type} IFC parse failed`, { id: `ifc-${type}-${nodeId}` });
    }
  }, [nodeId, updateNode]);

  // Accuracy meter calculation
  const baseAccuracy = 68;
  const structBonus = structural ? 12 : 0;
  const mepBonus = mep ? 10 : 0;
  const totalAccuracy = baseAccuracy + structBonus + mepBonus;
  const barColor = totalAccuracy >= 85 ? "#10B981" : totalAccuracy >= 75 ? "#FFBF00" : "#00F5FF";

  const onDrop = useCallback((e: React.DragEvent, type: "structural" | "mep") => {
    e.preventDefault(); e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) handleSupplementary(f, type);
  }, [handleSupplementary]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);

  return (
    <div className="nodrag nowheel nopan" onMouseDown={stopAll} onClick={stopAll} onKeyDown={stopAll}
      style={{ marginTop: 8 }}>
      <input ref={structRef} type="file" accept=".ifc" style={{ display: "none" }}
        onChange={e => { if (e.target.files?.[0]) handleSupplementary(e.target.files[0], "structural"); }} />
      <input ref={mepRef} type="file" accept=".ifc" style={{ display: "none" }}
        onChange={e => { if (e.target.files?.[0]) handleSupplementary(e.target.files[0], "mep"); }} />

      {/* ── Accuracy Meter ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={nodeText.sectionHdr}>Estimate Accuracy</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: barColor, fontFamily: "monospace" }}>~{totalAccuracy}%</span>
      </div>
      <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden", marginBottom: 10 }}>
        <div style={{ height: "100%", width: `${totalAccuracy}%`, background: `linear-gradient(90deg, ${barColor}, ${barColor}dd)`, borderRadius: 2, transition: "width 0.6s ease, background 0.6s ease" }} />
      </div>

      {/* ── Boost Accuracy Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ ...nodeText.sectionHdr, whiteSpace: "nowrap" }}>Boost Accuracy</span>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
      </div>

      {/* ── Structural IFC Drop Zone ── */}
      <div
        onClick={() => !structural && structRef.current?.click()}
        onDrop={e => onDrop(e, "structural")}
        onDragOver={onDragOver}
        style={{
          padding: "8px 10px", marginBottom: 6, borderRadius: 6, cursor: structural ? "default" : "pointer",
          border: structural ? "1px solid rgba(16,185,129,0.3)" : "1.5px dashed rgba(255,255,255,0.12)",
          background: structural ? "rgba(16,185,129,0.05)" : "rgba(0,0,0,0.15)",
          transition: "all 0.2s",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            background: structural ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.04)",
          }}>
            <span style={{ fontSize: 13, opacity: structural ? 1 : 0.4 }}>{structural ? "✓" : "⊞"}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: structural ? "#34D399" : "#D6DAE4", letterSpacing: "0.01em" }}>
                {structural ? structural : "Structural IFC"}
              </span>
              {!structural && (
                <span style={{ ...nodeText.helper, fontStyle: "italic", opacity: 0.9 }}>optional</span>
              )}
            </div>
            <div style={{ ...nodeText.helper, marginTop: 2 }}>
              {structural ? "Foundation, rebar, columns, beams" : "Foundations, rebar, columns, beams"}
            </div>
            {!structural && (
              <div style={{ ...nodeText.helper, marginTop: 3, display: "flex", alignItems: "center", gap: 4, color: "#00F5FF", opacity: 0.85 }}>
                <span style={{ fontSize: 10 }}>↑</span> Click or drag to upload
              </div>
            )}
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, flexShrink: 0, marginTop: 2,
            background: structural ? "rgba(16,185,129,0.18)" : "rgba(0,245,255,0.12)",
            color: structural ? "#34D399" : "#4FE8F5",
            letterSpacing: "0.02em",
          }}>
            {structural ? "✓ +12%" : "+12%"}
          </span>
        </div>
      </div>

      {/* ── MEP IFC Drop Zone ── */}
      <div
        onClick={() => !mep && mepRef.current?.click()}
        onDrop={e => onDrop(e, "mep")}
        onDragOver={onDragOver}
        style={{
          padding: "8px 10px", marginBottom: 6, borderRadius: 6, cursor: mep ? "default" : "pointer",
          border: mep ? "1px solid rgba(16,185,129,0.3)" : "1.5px dashed rgba(255,255,255,0.12)",
          background: mep ? "rgba(16,185,129,0.05)" : "rgba(0,0,0,0.15)",
          transition: "all 0.2s",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            background: mep ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.04)",
          }}>
            <span style={{ fontSize: 13, opacity: mep ? 1 : 0.4 }}>{mep ? "✓" : "⚙"}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: mep ? "#34D399" : "#D6DAE4", letterSpacing: "0.01em" }}>
                {mep ? mep : "MEP IFC"}
              </span>
              {!mep && (
                <span style={{ ...nodeText.helper, fontStyle: "italic", opacity: 0.9 }}>optional</span>
              )}
            </div>
            <div style={{ ...nodeText.helper, marginTop: 2 }}>
              {mep ? "Plumbing, electrical, HVAC, fire" : "Plumbing, electrical, HVAC, fire"}
            </div>
            {!mep && (
              <div style={{ ...nodeText.helper, marginTop: 3, display: "flex", alignItems: "center", gap: 4, color: "#00F5FF", opacity: 0.85 }}>
                <span style={{ fontSize: 10 }}>↑</span> Click or drag to upload
              </div>
            )}
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, flexShrink: 0, marginTop: 2,
            background: mep ? "rgba(16,185,129,0.18)" : "rgba(0,245,255,0.12)",
            color: mep ? "#34D399" : "#4FE8F5",
            letterSpacing: "0.02em",
          }}>
            {mep ? "✓ +10%" : "+10%"}
          </span>
        </div>
      </div>

      {/* ── QS Corrections (informational only) ── */}
      <div style={{
        padding: "8px 10px", borderRadius: 6,
        border: "1px solid rgba(255,191,0,0.15)",
        background: "rgba(255,191,0,0.03)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            background: "rgba(255,191,0,0.08)",
          }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>✎</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#FFBF00", letterSpacing: "0.01em" }}>QS corrections</span>
              <span style={{ ...nodeText.helper, fontStyle: "italic", opacity: 0.95 }}>builds over time</span>
            </div>
            <div style={{ ...nodeText.helper, marginTop: 2 }}>
              Edit rates in BOQ results to train the system
            </div>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, flexShrink: 0, marginTop: 2,
            background: "rgba(255,191,0,0.14)", color: "#FFD24D",
            letterSpacing: "0.02em",
          }}>
            +5% over time
          </span>
        </div>
      </div>
    </div>
  );

}

// ─── Location Input (IN-006) ─────────────────────────────────────────────────

const LOCATION_COUNTRIES = [
  { label: "USA", code: "US", currency: "USD", symbol: "$" },
  { label: "India", code: "IN", currency: "INR", symbol: "₹" },
  { label: "UK", code: "GB", currency: "GBP", symbol: "£" },
  { label: "UAE", code: "AE", currency: "AED", symbol: "د.إ" },
  { label: "Australia", code: "AU", currency: "AUD", symbol: "A$" },
  { label: "Canada", code: "CA", currency: "CAD", symbol: "C$" },
  { label: "Germany", code: "DE", currency: "EUR", symbol: "€" },
  { label: "Saudi Arabia", code: "SA", currency: "SAR", symbol: "﷼" },
  { label: "Singapore", code: "SG", currency: "SGD", symbol: "S$" },
  { label: "Japan", code: "JP", currency: "JPY", symbol: "¥" },
  { label: "China", code: "CN", currency: "CNY", symbol: "¥" },
  { label: "Brazil", code: "BR", currency: "BRL", symbol: "R$" },
  { label: "France", code: "FR", currency: "EUR", symbol: "€" },
  { label: "South Korea", code: "KR", currency: "KRW", symbol: "₩" },
  { label: "Mexico", code: "MX", currency: "MXN", symbol: "$" },
  { label: "Qatar", code: "QA", currency: "QAR", symbol: "﷼" },
  { label: "Nigeria", code: "NG", currency: "NGN", symbol: "₦" },
  { label: "South Africa", code: "ZA", currency: "ZAR", symbol: "R" },
];

const selectStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box" as const,
  padding: "7px 8px", borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.4)", color: "#E6E9F0",
  fontSize: 12, fontWeight: 500, outline: "none", fontFamily: "inherit",
  cursor: "pointer",
  letterSpacing: "0.01em",
};

const inputStyle: React.CSSProperties = {
  ...selectStyle, cursor: "text",
};

const labelStyle: React.CSSProperties = {
  ...nodeText.label, marginBottom: 4, display: "block",
};

export const LocationInput = memo(function LocationInput({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  const updateNode = useWorkflowStore(s => s.updateNode);

  // Parse stored JSON or default
  const stored = useMemo(() => {
    try {
      const raw = data.inputValue as string;
      if (raw && raw.startsWith("{")) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { country: "", state: "", city: "", currency: "", escalation: "6", contingency: "10", months: "6", soilType: "", plotArea: "" };
  }, [data.inputValue]);

  const update = useCallback((patch: Record<string, string>) => {
    const currentNode = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
    if (!currentNode) return;
    const prev = (() => {
      try {
        const raw = (currentNode.data as Record<string, unknown>).inputValue as string;
        if (raw && raw.startsWith("{")) return JSON.parse(raw);
      } catch { /* ignore */ }
      return { country: "", state: "", city: "", currency: "", escalation: "6", contingency: "10", months: "6", soilType: "", plotArea: "" };
    })();
    const next = { ...prev, ...patch };
    updateNode(nodeId, { data: { ...currentNode.data, inputValue: JSON.stringify(next) } });
  }, [nodeId, updateNode]);

  // Lazy-load location data to avoid importing at module level
  const locationData = useMemo(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("@/features/boq/constants/regional-factors");
      return {
        states: (mod.STATES_BY_COUNTRY ?? {}) as Record<string, string[]>,
        citiesByState: (mod.CITIES_BY_STATE ?? {}) as Record<string, Record<string, string[]>>,
        citiesDirect: (mod.CITIES_DIRECT ?? {}) as Record<string, string[]>,
      };
    } catch {
      return { states: {}, citiesByState: {}, citiesDirect: {} };
    }
  }, []);

  const countryCode = LOCATION_COUNTRIES.find(c => c.label === stored.country)?.code || "";
  const hasStates = countryCode && Object.keys(locationData.states[countryCode] || []).length > 0;
  const stateList = hasStates ? (locationData.states[countryCode] || []) : [];
  const hasCitiesDirect = !hasStates && countryCode && (locationData.citiesDirect[countryCode] || []).length > 0;

  // Get cities: from state-based lookup OR direct country list
  const cityList = useMemo(() => {
    if (!countryCode) return [];
    if (hasStates && stored.state) {
      const stateCities = locationData.citiesByState[countryCode]?.[stored.state];
      return stateCities || [];
    }
    if (hasCitiesDirect) {
      return locationData.citiesDirect[countryCode] || [];
    }
    return [];
  }, [countryCode, stored.state, hasStates, hasCitiesDirect, locationData]);

  const onCountryChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const country = e.target.value;
    const entry = LOCATION_COUNTRIES.find(c => c.label === country);
    update({ country, currency: entry?.currency || "", state: "", city: "" });
  }, [update]);

  const onStateChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    update({ state: e.target.value, city: "" }); // Reset city when state changes
  }, [update]);

  const hasLocation = !!stored.country;

  return (
    <div className="nodrag nowheel nopan" onMouseDown={stopAll} onClick={stopAll} onKeyDown={stopAll}
      style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
      {/* Country */}
      <div>
        <label style={labelStyle}>Country</label>
        <select value={stored.country || ""} onChange={onCountryChange} style={selectStyle}>
          <option value="">Select country...</option>
          {LOCATION_COUNTRIES.map(c => (
            <option key={c.code} value={c.label}>{c.label}</option>
          ))}
        </select>
      </div>
      {/* State dropdown (only for countries with states) */}
      {hasLocation && hasStates && (
        <div>
          <label style={labelStyle}>State / Region</label>
          <select value={stored.state || ""} onChange={onStateChange} style={selectStyle}>
            <option value="">Select state...</option>
            {stateList.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}
      {/* City dropdown */}
      {hasLocation && cityList.length > 0 && (
        <div>
          <label style={labelStyle}>City</label>
          <select value={stored.city || ""} onChange={e => update({ city: e.target.value })} style={selectStyle}>
            <option value="">Select city...</option>
            {cityList.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      )}
      {/* Fallback: show city text input if no dropdown data */}
      {hasLocation && cityList.length === 0 && (hasStates ? !!stored.state : true) && (
        <div>
          <label style={labelStyle}>City</label>
          <input type="text" value={stored.city || ""} placeholder="Enter city name"
            onChange={e => update({ city: e.target.value })} style={inputStyle} />
        </div>
      )}
      {/* Currency */}
      {hasLocation && (
        <div>
          <label style={labelStyle}>Currency</label>
          <select value={stored.currency || ""} onChange={e => update({ currency: e.target.value })} style={selectStyle}>
            {[...new Set(LOCATION_COUNTRIES.map(c => c.currency))].map(cur => {
              const entry = LOCATION_COUNTRIES.find(c => c.currency === cur);
              return <option key={cur} value={cur}>{entry?.symbol} {cur}</option>;
            })}
          </select>
        </div>
      )}
      {/* Project Cost Settings */}
      {hasLocation && (
        <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Escalation %/yr</label>
            <input type="number" value={stored.escalation ?? "6"} min={0} max={20} step={0.5}
              onChange={e => update({ escalation: e.target.value })} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Contingency %</label>
            <input type="number" value={stored.contingency ?? "10"} min={0} max={30} step={1}
              onChange={e => update({ contingency: e.target.value })} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Months</label>
            <input type="number" value={stored.months ?? "6"} min={0} max={36} step={1}
              onChange={e => update({ months: e.target.value })} style={inputStyle} />
          </div>
        </div>
      )}
      {/* Site conditions */}
      {hasLocation && (
        <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Soil type</label>
            <select value={stored.soilType || ""} onChange={e => update({ soilType: e.target.value })} style={selectStyle}>
              <option value="">Auto (from floors)</option>
              <option value="hard_rock">Hard Rock</option>
              <option value="medium">Medium Soil</option>
              <option value="soft_clay">Soft Clay</option>
              <option value="waterlogged">Waterlogged</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Plot area m²</label>
            <input type="number" value={stored.plotArea || ""} placeholder="Optional" min={0} max={100000} step={10}
              onChange={e => update({ plotArea: e.target.value })} style={inputStyle} />
          </div>
        </div>
      )}
      {/* Summary */}
      {hasLocation && stored.city && (
        <div style={{
          fontSize: 11, fontWeight: 500, color: "#4FE8F5",
          textAlign: "center", marginTop: 6,
          letterSpacing: "0.02em",
          textShadow: "0 1px 2px rgba(0,0,0,0.65)",
        }}>
          📍 {stored.city}{stored.state ? ", " + stored.state : ""}, {stored.country} ({stored.currency})
        </div>
      )}
    </div>
  );
});

// ─── Multi-Image Upload (IN-008) ──────────────────────────────────────────────

export const MultiImageUploadInput = memo(function MultiImageUploadInput({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  const updateNode = useWorkflowStore(s => s.updateNode);
  const t = useLocale(s => s.t);
  const inputRef = useRef<HTMLInputElement>(null);
  const maxMB = 10;

  const fileNames = (data.fileNames as string[] | undefined) ?? [];
  const imageCount = fileNames.length;

  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const validFiles: File[] = [];
    for (const file of fileArray) {
      if (file.size > maxMB * 1024 * 1024) {
        toast.error(`${file.name} exceeds ${maxMB}MB limit`);
        continue;
      }
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
        toast.error(`${file.name}: unsupported format. Use PNG, JPG, or WebP.`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) return;

    // Merge with existing files
    const existing = inputMultiFileStore.get(nodeId) ?? [];
    const merged = [...existing, ...validFiles];
    inputMultiFileStore.set(nodeId, merged);

    // Convert all files to base64
    const names: string[] = merged.map(f => f.name);
    const sizes: number[] = merged.map(f => f.size);
    const mimes: string[] = merged.map(f => f.type);

    // Update immediately with names
    const currentNode = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
    if (!currentNode) return;
    updateNode(nodeId, {
      data: {
        ...currentNode.data,
        inputValue: `${merged.length} image${merged.length > 1 ? "s" : ""} uploaded`,
        fileNames: names,
        fileSizes: sizes,
        mimeTypes: mimes,
        imageCount: merged.length,
      },
    });

    // Read all files to base64
    Promise.all(merged.map(f => new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.readAsDataURL(f);
    }))).then((base64Arr) => {
      const node = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
      if (!node) return;
      updateNode(nodeId, {
        data: {
          ...node.data,
          fileData: base64Arr,
          fileNames: names,
          fileSizes: sizes,
          mimeTypes: mimes,
          imageCount: merged.length,
        },
      });
    });
  }, [nodeId, updateNode]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    if (inputRef.current) inputRef.current.value = "";
  }, [handleFiles]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
  }, []);

  const onRemove = useCallback((idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const existing = inputMultiFileStore.get(nodeId) ?? [];
    existing.splice(idx, 1);
    inputMultiFileStore.set(nodeId, existing);

    if (existing.length === 0) {
      inputMultiFileStore.delete(nodeId);
      const currentNode = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
      if (!currentNode) return;
      updateNode(nodeId, {
        data: { ...currentNode.data, inputValue: "", fileNames: undefined, fileSizes: undefined, mimeTypes: undefined, fileData: undefined, imageCount: 0 },
      });
      return;
    }

    // Re-read remaining files
    const names = existing.map(f => f.name);
    const sizes = existing.map(f => f.size);
    const mimes = existing.map(f => f.type);

    Promise.all(existing.map(f => new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.readAsDataURL(f);
    }))).then((base64Arr) => {
      const node = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
      if (!node) return;
      updateNode(nodeId, {
        data: {
          ...node.data,
          inputValue: `${existing.length} image${existing.length > 1 ? "s" : ""} uploaded`,
          fileData: base64Arr,
          fileNames: names,
          fileSizes: sizes,
          mimeTypes: mimes,
          imageCount: existing.length,
        },
      });
    });
  }, [nodeId, updateNode]);

  const storedFiles = inputMultiFileStore.get(nodeId) ?? [];

  return (
    <div className="nodrag nowheel nopan" onMouseDown={stopAll} onClick={stopAll} onKeyDown={stopAll}>
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        multiple
        onChange={onFileChange}
        style={{ display: "none" }}
      />

      {/* Thumbnail grid of uploaded images */}
      {imageCount > 0 && (
        <div style={{
          marginTop: 8, display: "grid",
          gridTemplateColumns: imageCount === 1 ? "1fr" : "1fr 1fr",
          gap: 4,
        }}>
          {storedFiles.map((file, idx) => (
            <div key={`${file.name}-${idx}`} style={{
              position: "relative", borderRadius: 4, overflow: "hidden",
              border: "1px solid rgba(16,185,129,0.25)",
              background: "rgba(16,185,129,0.06)",
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={URL.createObjectURL(file)}
                alt={file.name}
                style={{ width: "100%", height: imageCount === 1 ? 60 : 44, objectFit: "cover", display: "block" }}
              />
              <button
                onClick={(e) => onRemove(idx, e)}
                style={{
                  position: "absolute", top: 2, right: 2,
                  width: 14, height: 14, borderRadius: "50%",
                  background: "rgba(0,0,0,0.7)", color: "#fff",
                  border: "none", cursor: "pointer", fontSize: 8,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
              <div style={{
                fontSize: 10, fontWeight: 500, color: "#34D399",
                padding: "3px 6px",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                letterSpacing: "0.01em",
              }}>
                {file.name}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload area / Add more button */}
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        style={{
          marginTop: imageCount > 0 ? 4 : 8,
          padding: imageCount > 0 ? "6px 8px" : "10px 8px",
          borderRadius: 6, cursor: "pointer",
          border: "1px dashed rgba(0,245,255,0.25)",
          background: "rgba(0,245,255,0.03)",
          textAlign: "center",
          transition: "all 0.15s",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,245,255,0.5)";
          (e.currentTarget as HTMLElement).style.background = "rgba(0,245,255,0.07)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,245,255,0.25)";
          (e.currentTarget as HTMLElement).style.background = "rgba(0,245,255,0.03)";
        }}
      >
        <div style={nodeText.helper}>
          {imageCount > 0
            ? <><span style={nodeText.hintLink}>+ Add more images</span></>
            : <>Drop images {t('input.dropHereOr')} <span style={nodeText.hintLink}>{t('input.clickToBrowse')}</span></>
          }
        </div>
        {imageCount === 0 && (
          <div style={{ ...nodeText.meta, marginTop: 3 }}>
            .png,.jpg,.jpeg,.webp · max {maxMB}MB each · multiple allowed
          </div>
        )}
      </div>

      {/* Summary */}
      {imageCount > 0 && (
        <div style={{ fontSize: 11, fontWeight: 500, color: "#34D399", marginTop: 6, textAlign: "center", letterSpacing: "0.02em" }}>
          {imageCount} image{imageCount > 1 ? "s" : ""} · {((data.fileSizes as number[] | undefined)?.reduce((a, b) => a + b, 0) ?? 0 / 1024).toFixed(0)} KB total
        </div>
      )}
    </div>
  );
});

// ─── Selector: which component to render ─────────────────────────────────────

export const InputNodeContent = memo(function InputNodeContent({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  switch (data.catalogueId) {
    case "IN-001":
      return <TextPromptInput nodeId={nodeId} data={data} />;
    case "IN-002":
      return <FileUploadInput nodeId={nodeId} data={data} accept=".pdf" label="a PDF" maxMB={20} />;
    case "IN-003":
      return <FileUploadInput nodeId={nodeId} data={data} accept=".png,.jpg,.jpeg,.webp" label="an image" maxMB={10} showPreview />;
    case "IN-004":
      return (
        <>
          <FileUploadInput nodeId={nodeId} data={data} accept=".ifc" label="an IFC file" maxMB={100} />
          <SupplementaryIFCUpload nodeId={nodeId} />
        </>
      );
    case "IN-005":
      return <ParameterInput nodeId={nodeId} data={data} />;
    case "IN-006":
      return <LocationInput nodeId={nodeId} data={data} />;
    case "IN-007":
      return <FileUploadInput nodeId={nodeId} data={data} accept=".dxf,.dwg" label="a DXF/DWG file" maxMB={30} />;
    case "IN-008":
      return <MultiImageUploadInput nodeId={nodeId} data={data} />;
    default:
      return null;
  }
});
