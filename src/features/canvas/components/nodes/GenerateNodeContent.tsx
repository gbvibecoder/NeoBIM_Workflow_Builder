"use client";

import React, { useCallback, useMemo, memo } from "react";
import { useWorkflowStore } from "@/features/workflows/stores/workflow-store";
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
        padding: "6px 10px",
        background: "rgba(0,0,0,0.4)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        color: "#E6E9F0",
        cursor: "pointer",
        outline: "none",
        letterSpacing: "0.01em",
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLSelectElement).style.borderColor = "rgba(0,245,255,0.4)";
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLSelectElement).style.borderColor = "rgba(255,255,255,0.14)";
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
