"use client";

import React, { useCallback } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { WorkflowNodeData } from "@/types/nodes";

const VIEW_TYPE_OPTIONS = [
  { value: "exterior", label: "Exterior Render" },
  { value: "floor_plan", label: "Floor Plan" },
  { value: "site_plan", label: "Site Plan" },
  { value: "interior", label: "Interior View" },
] as const;

export function ViewTypeSelect({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  const updateNode = useWorkflowStore(s => s.updateNode);

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const currentNode = useWorkflowStore.getState().nodes.find(n => n.id === nodeId);
      if (!currentNode) return;
      updateNode(nodeId, {
        data: { ...currentNode.data, viewType: e.target.value },
      });
    },
    [nodeId, updateNode]
  );

  return (
    <select
      className="nodrag nowheel nopan"
      value={(data.viewType as string) ?? "exterior"}
      onChange={onChange}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      style={{
        width: "100%",
        marginTop: 8,
        padding: "4px 8px",
        background: "#1A1A2A",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 6,
        fontSize: 11,
        color: "#d1d5db",
        cursor: "pointer",
        outline: "none",
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLSelectElement).style.borderColor = "rgba(255,255,255,0.2)";
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLSelectElement).style.borderColor = "rgba(255,255,255,0.1)";
      }}
    >
      {VIEW_TYPE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
