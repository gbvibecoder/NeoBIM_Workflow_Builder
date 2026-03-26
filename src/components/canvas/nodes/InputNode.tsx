"use client";

/**
 * Interactive input node shell + per-type input components.
 * All interactive elements use nodrag/nowheel/nopan class + stopPropagation
 * so React Flow doesn't interfere with typing/clicking.
 */

import React, { useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useLocale } from "@/hooks/useLocale";
import type { WorkflowNodeData } from "@/types/nodes";

// ─── File store (module-level, not in Zustand — files can't serialize) ───────
export const inputFileStore = new Map<string, File>();
export const inputMultiFileStore = new Map<string, File[]>();

// ─── Shared stop-propagation handler ─────────────────────────────────────────
function stopAll(e: React.SyntheticEvent) {
  e.stopPropagation();
}

// ─── Text Prompt (IN-001) ────────────────────────────────────────────────────

export function TextPromptInput({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
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
        textAlign: "right", fontSize: 9, color: "#3A3A4E", marginTop: 2,
      }}>
        {value.length} / 2000
      </div>
    </div>
  );
}

// ─── File Upload (PDF, IFC, Image, DXF) ─────────────────────────────────────

interface FileUploadProps {
  nodeId: string;
  data: WorkflowNodeData;
  accept: string;
  label: string;
  maxMB?: number;
  showPreview?: boolean;
}

export function FileUploadInput({ nodeId, data, accept, label, maxMB = 20, showPreview }: FileUploadProps) {
  const updateNode = useWorkflowStore(s => s.updateNode);
  const t = useLocale(s => s.t);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileName = data.inputValue as string | undefined;
  const hasFile = !!fileName;

  const handleFile = useCallback((file: File) => {
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
      toast.loading("Parsing IFC file...", { id: `ifc-parse-${nodeId}` });

      // Read file as text and parse in the browser — zero server calls
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const text = reader.result as string;
          // Dynamic import to keep bundle size small
          const { parseIFCText } = await import("@/services/ifc-text-parser");
          const result = parseIFCText(text);

          const node = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
          if (!node) return;

          updateNode(nodeId, {
            data: {
              ...node.data,
              inputValue: file.name,
              fileSize: file.size,
              fileName: file.name,
              mimeType: file.type,
              ifcParsed: result, // Pre-parsed result — no base64, no server upload
              fileData: undefined, // Never store large base64
              ifcUrl: undefined,
            },
          });

          toast.success(
            `IFC parsed: ${result.summary.totalElements} elements, ${result.summary.buildingStoreys} storeys`,
            { id: `ifc-parse-${nodeId}`, duration: 5000 }
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Parse failed";
          toast.error(`IFC parse failed: ${msg}`, { id: `ifc-parse-${nodeId}`, duration: 8000 });
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
              fontSize: 10, color: "#10B981", flex: 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {fileName}
            </span>
            <button
              onClick={onRemove}
              style={{
                fontSize: 9, color: "#55556A", background: "none",
                border: "none", cursor: "pointer", padding: 0,
              }}
            >
              ✕
            </button>
          </div>
          {(data.fileSize as number | undefined) && (
            <span style={{ fontSize: 9, color: "#55556A" }}>
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
          <div style={{ fontSize: 9, color: "#55556A", lineHeight: 1.5 }}>
            Drop {label} {t('input.dropHereOr')} <span style={{ color: "#00F5FF" }}>{t('input.clickToBrowse')}</span>
          </div>
          <div style={{ fontSize: 8, color: "#3A3A4E", marginTop: 2 }}>
            {accept} · max {maxMB}MB
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Parameter Input (IN-005) ─────────────────────────────────────────────────

interface Params { floors: number; gfa: number; height: number; style: string }

export function ParameterInput({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
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
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(0,0,0,0.3)", color: "#F0F0F5",
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
      style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}
    >
      {rows.map(row => (
        <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 11, color: "#5C5C78", fontWeight: 500, width: 60, flexShrink: 0 }}>
            {row.label}
          </label>
          {row.type === "number" ? (
            <input
              type="number"
              value={params[row.key] as number}
              onChange={e => update(row.key, parseFloat(e.target.value) || 0)}
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
  padding: "5px 6px", borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.07)",
  background: "rgba(0,0,0,0.4)", color: "#C0C0D0",
  fontSize: 10, outline: "none", fontFamily: "inherit",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  ...selectStyle, cursor: "text",
};

const labelStyle: React.CSSProperties = {
  fontSize: 9, color: "#3A3A4E", marginBottom: 2, display: "block",
};

export function LocationInput({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  const updateNode = useWorkflowStore(s => s.updateNode);

  // Parse stored JSON or default
  const stored = useMemo(() => {
    try {
      const raw = data.inputValue as string;
      if (raw && raw.startsWith("{")) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { country: "", state: "", city: "", currency: "", escalation: "6", contingency: "10", months: "6" };
  }, [data.inputValue]);

  const update = useCallback((patch: Record<string, string>) => {
    const currentNode = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
    if (!currentNode) return;
    const prev = (() => {
      try {
        const raw = (currentNode.data as Record<string, unknown>).inputValue as string;
        if (raw && raw.startsWith("{")) return JSON.parse(raw);
      } catch { /* ignore */ }
      return { country: "", state: "", city: "", currency: "", escalation: "6", contingency: "10", months: "6" };
    })();
    const next = { ...prev, ...patch };
    updateNode(nodeId, { data: { ...currentNode.data, inputValue: JSON.stringify(next) } });
  }, [nodeId, updateNode]);

  // Lazy-load location data to avoid importing at module level
  const locationData = useMemo(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("@/constants/regional-factors");
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
      {/* Summary */}
      {hasLocation && stored.city && (
        <div style={{ fontSize: 9, color: "#00F5FF", opacity: 0.7, textAlign: "center", marginTop: 2 }}>
          📍 {stored.city}{stored.state ? ", " + stored.state : ""}, {stored.country} ({stored.currency})
        </div>
      )}
    </div>
  );
}

// ─── Multi-Image Upload (IN-008) ──────────────────────────────────────────────

export function MultiImageUploadInput({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
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
                fontSize: 8, color: "#10B981", padding: "2px 4px",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
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
        <div style={{ fontSize: 9, color: "#55556A", lineHeight: 1.5 }}>
          {imageCount > 0
            ? <><span style={{ color: "#00F5FF" }}>+ Add more images</span></>
            : <>Drop images {t('input.dropHereOr')} <span style={{ color: "#00F5FF" }}>{t('input.clickToBrowse')}</span></>
          }
        </div>
        {imageCount === 0 && (
          <div style={{ fontSize: 8, color: "#3A3A4E", marginTop: 2 }}>
            .png,.jpg,.jpeg,.webp · max {maxMB}MB each · multiple allowed
          </div>
        )}
      </div>

      {/* Summary */}
      {imageCount > 0 && (
        <div style={{ fontSize: 9, color: "#10B981", marginTop: 4, textAlign: "center" }}>
          {imageCount} image{imageCount > 1 ? "s" : ""} · {((data.fileSizes as number[] | undefined)?.reduce((a, b) => a + b, 0) ?? 0 / 1024).toFixed(0)} KB total
        </div>
      )}
    </div>
  );
}

// ─── Selector: which component to render ─────────────────────────────────────

export function InputNodeContent({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  switch (data.catalogueId) {
    case "IN-001":
      return <TextPromptInput nodeId={nodeId} data={data} />;
    case "IN-002":
      return <FileUploadInput nodeId={nodeId} data={data} accept=".pdf" label="a PDF" maxMB={20} />;
    case "IN-003":
      return <FileUploadInput nodeId={nodeId} data={data} accept=".png,.jpg,.jpeg,.webp" label="an image" maxMB={10} showPreview />;
    case "IN-004":
      return <FileUploadInput nodeId={nodeId} data={data} accept=".ifc" label="an IFC file" maxMB={50} />;
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
}
