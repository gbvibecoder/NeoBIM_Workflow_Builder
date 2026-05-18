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
        padding: "6px 0",
        gap: 8,
        borderBottom: `1px dashed ${UI.border.subtle}`,
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
      <div
        style={{
          padding: 32,
          color: UI.text.tertiary,
          fontSize: 12.5,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          fontFamily: "Geist, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            background: UI.bg.cream,
            border: `1px solid ${UI.border.subtle}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {/* Architectural blueprint glyph */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ opacity: 0.6, color: UI.text.tertiary }}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="9" x2="9" y2="21" />
            <line x1="14" y1="3" x2="14" y2="9" />
          </svg>
        </div>
        <div>
          <div
            style={{
              fontSize: 13,
              color: UI.text.primary,
              fontWeight: 600,
              fontFamily: "Fraunces, Georgia, serif",
              fontStyle: "italic",
              marginBottom: 4,
            }}
          >
            Nothing inspected yet
          </div>
          <div style={{ lineHeight: 1.5, maxWidth: 240 }}>
            Click any element in the 3D viewport or pick from the Tree tab —
            details appear here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 14, overflowY: "auto", height: "100%" }}>
      {/* Selected element card — drafting strip on the left */}
      <div
        style={{
          position: "relative",
          background: UI.bg.paper,
          border: `1px solid ${UI.border.subtle}`,
          borderRadius: UI.radius.md,
          padding: "12px 14px",
          marginBottom: 14,
          paddingLeft: 16,
        }}
      >
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 8,
            bottom: 8,
            left: 0,
            width: 3,
            background: "var(--rs-blueprint)",
            borderRadius: 2,
          }}
        />
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: 1.0,
            textTransform: "uppercase",
            color: UI.text.tertiary,
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            marginBottom: 4,
          }}
        >
          {element.typeName}
        </div>
        <h4
          style={{
            color: UI.text.primary,
            fontSize: 16,
            fontWeight: 500,
            margin: "0 0 6px",
            fontFamily: "Fraunces, Georgia, serif",
            fontStyle: "italic",
            letterSpacing: -0.1,
          }}
        >
          {element.name || element.typeName}
        </h4>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: UI.text.tertiary,
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
          }}
        >
          Express ID · {element.expressID}
        </div>
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
            borderBottom: `1px solid ${UI.border.subtle}`,
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
            borderBottom: `1px solid ${UI.border.subtle}`,
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
