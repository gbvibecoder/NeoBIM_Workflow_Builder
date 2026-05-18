"use client";

import React, { useState, useCallback, useMemo } from "react";
import {
  ChevronRight, ChevronDown, Building2, Layers, Box, Search,
} from "lucide-react";
import { UI } from "@/features/ifc/components/constants";
import type { SpatialNode, ViewportHandle } from "@/types/ifc-viewer";

interface ModelTreeProps {
  tree: SpatialNode[];
  selectedID: number | null;
  viewportRef: React.RefObject<ViewportHandle | null>;
}

/* Icon for IFC type */
function typeIcon(type: string) {
  if (type === "IFCPROJECT" || type === "IFCSITE") return Building2;
  if (type === "IFCBUILDING" || type === "IFCBUILDINGSTOREY") return Layers;
  return Box;
}

/* Recursive tree node */
function TreeNode({
  node,
  depth,
  selectedID,
  onSelect,
  filter,
}: {
  node: SpatialNode;
  depth: number;
  selectedID: number | null;
  onSelect: (id: number) => void;
  filter: string;
}) {
  const [expanded, setExpanded] = useState(depth < 3);
  const hasChildren = node.children.length > 0;
  const isSelected = node.expressID === selectedID;
  const isGroup = node.type === "GROUP";
  const Icon = typeIcon(node.type);

  /* Filter matching */
  const matchesFilter = !filter || node.name.toLowerCase().includes(filter.toLowerCase());
  const hasMatchingChild = useMemo(() => {
    if (!filter) return true;
    const check = (n: SpatialNode): boolean =>
      n.name.toLowerCase().includes(filter.toLowerCase()) || n.children.some(check);
    return check(node);
  }, [node, filter]);

  if (filter && !matchesFilter && !hasMatchingChild) return null;

  return (
    <div>
      <div
        onClick={() => {
          if (node.expressID > 0) onSelect(node.expressID);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          paddingLeft: depth * 16 + 8,
          paddingRight: 8,
          height: 32,
          position: "relative",
          cursor: node.expressID > 0 ? "pointer" : "default",
          background: isSelected ? "var(--rs-blueprint-soft)" : "transparent",
          borderLeft: isSelected ? `2px solid var(--rs-blueprint)` : "2px solid transparent",
          transition: UI.transition,
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = UI.bg.cream;
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = "transparent";
        }}
      >
        {/* Indentation guides */}
        {depth > 0 && Array.from({ length: depth }, (_, i) => (
          <div
            key={`guide-${i}`}
            style={{
              position: "absolute",
              left: i * 16 + 16,
              top: 0,
              bottom: 0,
              width: 1,
              background: UI.border.subtle,
            }}
          />
        ))}

        {/* Expand/collapse */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((p) => !p);
          }}
          style={{
            width: 16,
            height: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            color: UI.text.tertiary,
            cursor: hasChildren ? "pointer" : "default",
            padding: 0,
            visibility: hasChildren ? "visible" : "hidden",
          }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {/* Icon */}
        {!isGroup && <Icon size={13} style={{ color: UI.text.tertiary, flexShrink: 0 }} />}

        {/* Label */}
        <span
          style={{
            fontSize: 12,
            color: isSelected ? UI.text.primary : isGroup ? UI.text.secondary : UI.text.secondary,
            fontWeight: isGroup || depth < 2 ? 500 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-dm-sans)",
          }}
        >
          {node.name}
        </span>

        {/* Element count badge */}
        {node.elementCount > 0 && !isGroup && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10,
              color: UI.text.tertiary,
              background: UI.bg.cream,
              border: `1px solid ${UI.border.subtle}`,
              padding: "1px 7px",
              borderRadius: 10,
              fontFamily: UI.font.mono,
              flexShrink: 0,
              fontWeight: 600,
            }}
          >
            {node.elementCount}
          </span>
        )}
      </div>

      {/* Children */}
      {expanded &&
        hasChildren &&
        node.children.map((child, i) => (
          <TreeNode
            key={`${child.expressID}-${i}`}
            node={child}
            depth={depth + 1}
            selectedID={selectedID}
            onSelect={onSelect}
            filter={filter}
          />
        ))}
    </div>
  );
}

export function ModelTree({ tree, selectedID, viewportRef }: ModelTreeProps) {
  const [filter, setFilter] = useState("");

  const handleSelect = useCallback(
    (id: number) => {
      viewportRef.current?.selectByExpressID(id);
    },
    [viewportRef]
  );

  if (tree.length === 0) {
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
          gap: 10,
          fontFamily: UI.font.body,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: UI.bg.cream,
            border: `1px solid ${UI.border.subtle}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Building2 size={20} color={UI.text.tertiary} strokeWidth={1.6} />
        </div>
        <div style={{ maxWidth: 240, lineHeight: 1.5 }}>
          The IFC didn&apos;t expose a spatial structure — try a richer file or use
          the Inspect tab to drill into individual elements.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Search */}
      <div style={{ padding: "10px 12px 8px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: UI.radius.md,
            background: UI.bg.cream,
            border: `1px solid ${UI.border.subtle}`,
          }}
        >
          <Search size={12} color={UI.text.tertiary} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter spatial nodes…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: UI.text.primary,
              fontSize: 11.5,
              fontFamily: UI.font.mono,
            }}
          />
        </div>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: 8 }}>
        {tree.map((node, i) => (
          <TreeNode
            key={`${node.expressID}-${i}`}
            node={node}
            depth={0}
            selectedID={selectedID}
            onSelect={handleSelect}
            filter={filter}
          />
        ))}
      </div>
    </div>
  );
}
