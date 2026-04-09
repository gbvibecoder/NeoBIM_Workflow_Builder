"use client";

import React, { useCallback, useMemo, memo } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useLocale } from "@/hooks/useLocale";
import type { WorkflowNodeData } from "@/types/nodes";

export const ViewTypeSelect = memo(function ViewTypeSelect({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  const updateNode = useWorkflowStore(s => s.updateNode);
  const t = useLocale(s => s.t);

  const VIEW_TYPE_OPTIONS = useMemo(() => [
    { value: "exterior", label: t('generate.exteriorRender') },
    { value: "floor_plan", label: t('generate.floorPlan') },
    { value: "site_plan", label: t('generate.sitePlan') },
    { value: "interior", label: t('generate.interiorView') },
  ], [t]);

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
});
