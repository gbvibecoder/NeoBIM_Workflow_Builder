"use client";

/**
 * Interactive input node shell + per-type input components.
 * All interactive elements use nodrag/nowheel/nopan class + stopPropagation
 * so React Flow doesn't interfere with typing/clicking.
 */

import React, { useRef, useCallback } from "react";
import { toast } from "sonner";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { WorkflowNodeData } from "@/types/nodes";

// ─── File store (module-level, not in Zustand — files can't serialize) ───────
export const inputFileStore = new Map<string, File>();

// ─── Shared stop-propagation handler ─────────────────────────────────────────
function stopAll(e: React.SyntheticEvent) {
  e.stopPropagation();
}

// ─── Text Prompt (IN-001) ────────────────────────────────────────────────────

export function TextPromptInput({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  const updateNode = useWorkflowStore(s => s.updateNode);
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
        placeholder={"Describe your building project…\ne.g. A 5-story mixed-use building with\nground-floor retail. Modern Nordic style."}
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
  const inputRef = useRef<HTMLInputElement>(null);
  const fileName = data.inputValue as string | undefined;
  const hasFile = !!fileName;

  const handleFile = useCallback((file: File) => {
    if (maxMB && file.size > maxMB * 1024 * 1024) {
      toast.error(`File too large. Max ${maxMB}MB.`);
      return;
    }
    inputFileStore.set(nodeId, file);
    const currentNode = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
    if (!currentNode) return;

    // Convert file to base64 so downstream nodes (TR-004, etc.) can access the data
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
  }, [nodeId, updateNode, maxMB]);

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
            Drop {label} here or <span style={{ color: "#00F5FF" }}>click to browse</span>
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

const STYLE_OPTIONS = ["Modern", "Nordic", "Classical", "Industrial", "Tropical", "Brutalist", "Minimalist"];

interface Params { floors: number; gfa: number; height: number; style: string }

export function ParameterInput({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  const updateNode = useWorkflowStore(s => s.updateNode);

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

  const rows: Array<{ key: keyof Params; label: string; type: "number" | "select" }> = [
    { key: "floors", label: "Floors",     type: "number" },
    { key: "gfa",    label: "GFA (m²)",   type: "number" },
    { key: "height", label: "Height (m)", type: "number" },
    { key: "style",  label: "Style",      type: "select" },
  ];

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
              {STYLE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Location Input (IN-006) ─────────────────────────────────────────────────

export function LocationInput({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  const updateNode = useWorkflowStore(s => s.updateNode);
  const value = (data.inputValue as string) ?? "";

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const currentNode = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
    if (!currentNode) return;
    updateNode(nodeId, { data: { ...currentNode.data, inputValue: e.target.value } });
  }, [nodeId, updateNode]);

  return (
    <div className="nodrag nowheel nopan" onMouseDown={stopAll} onClick={stopAll} onKeyDown={stopAll}>
      <div style={{ position: "relative", marginTop: 8 }}>
        <span style={{
          position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)",
          fontSize: 10, color: "#3A3A4E",
        }}>📍</span>
        <input
          type="text"
          value={value}
          onChange={onChange}
          placeholder="e.g. Alexanderplatz, Berlin"
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "6px 8px 6px 22px", borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(0,0,0,0.3)", color: "#C0C0D0",
            fontSize: 10, outline: "none", fontFamily: "inherit",
          }}
        />
      </div>
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
    default:
      return null;
  }
}
