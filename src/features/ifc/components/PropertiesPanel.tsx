"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { UI } from "@/features/ifc/components/constants";
import type { IFCElementData } from "@/types/ifc-viewer";

interface PropertiesPanelProps {
  element: IFCElementData | null;
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        background: "none",
        border: "none",
        color: UI.text.tertiary,
        cursor: "pointer",
        padding: 2,
        display: "flex",
      }}
      title="Copy"
    >
      {copied ? <Check size={10} color={UI.accent.green} /> : <Copy size={10} />}
    </button>
  );
}

function PropRow({ label, value }: { label: string; value: string | number | boolean }) {
  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : typeof value === "number" ? String(Math.round(value * 1000) / 1000) : String(value);
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "4px 0",
        gap: 8,
        borderBottom: `1px solid rgba(255,255,255,0.03)`,
      }}
    >
      <span style={{ color: UI.text.tertiary, fontSize: 12, minWidth: 80, flexShrink: 0 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
        <span
          style={{
            color: UI.text.primary,
            fontSize: 12,
            fontFamily: "var(--font-jetbrains)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {display || "—"}
        </span>
        {display && display !== "—" && <CopyBtn value={display} />}
      </div>
    </div>
  );
}

function PsetGroup({ name, properties }: { name: string; properties: { name: string; value: string | number | boolean }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: `1px solid ${UI.border.subtle}` }}>
      <button
        onClick={() => setOpen((p) => !p)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 0",
          background: "none",
          border: "none",
          color: UI.text.secondary,
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {name}
        <span style={{ color: UI.text.tertiary, fontSize: 11, marginLeft: "auto" }}>{properties.length}</span>
      </button>
      {open && (
        <div style={{ paddingLeft: 12, paddingBottom: 4 }}>
          {properties.map((p, i) => (
            <PropRow key={i} label={p.name} value={p.value} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PropertiesPanel({ element }: PropertiesPanelProps) {
  if (!element) {
    return (
      <div style={{
        padding: 24,
        color: UI.text.tertiary,
        fontSize: 13,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}>
        <div style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 4,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
            <path d="M3 3h7l2 2h9v15H3z"/>
          </svg>
        </div>
        <span>Click an element to view properties</span>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, overflowY: "auto", height: "100%" }}>
      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        <h4 style={{ color: UI.text.primary, fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
          {element.name || element.typeName}
        </h4>
        <span
          style={{
            display: "inline-block",
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 4,
            background: "rgba(79,138,255,0.08)",
            color: UI.accent.blue,
            fontWeight: 500,
            letterSpacing: "0.3px",
          }}
        >
          {element.typeName}
        </span>
      </div>

      {/* Core properties */}
      <div style={{ marginBottom: 8 }}>
        <PropRow label="Express ID" value={element.expressID} />
        <PropRow label="Global ID" value={element.globalId} />
        <PropRow label="Type" value={element.type} />
        {element.description && <PropRow label="Description" value={element.description} />}
        {element.material && <PropRow label="Material" value={element.material} />}
      </div>

      {/* Quantities */}
      {element.quantities.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <p style={{
            color: UI.text.secondary,
            fontSize: 11,
            fontWeight: 600,
            marginBottom: 6,
            textTransform: "uppercase" as const,
            letterSpacing: "0.5px",
            paddingBottom: 4,
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}>
            Quantities
          </p>
          {element.quantities.map((q, i) => (
            <PropRow key={i} label={q.name} value={`${q.value.toFixed(3)} ${q.unit}`} />
          ))}
        </div>
      )}

      {/* Property sets */}
      {element.propertySets.length > 0 && (
        <div>
          <p style={{
            color: UI.text.secondary,
            fontSize: 11,
            fontWeight: 600,
            marginBottom: 6,
            textTransform: "uppercase" as const,
            letterSpacing: "0.5px",
            paddingBottom: 4,
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}>
            Property Sets
          </p>
          {element.propertySets.map((ps, i) => (
            <PsetGroup key={i} name={ps.name} properties={ps.properties} />
          ))}
        </div>
      )}
    </div>
  );
}
