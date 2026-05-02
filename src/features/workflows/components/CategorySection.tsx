import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { WorkflowSummary } from "@/lib/api";
import type { WorkflowCategoryMeta } from "@/features/workflows/lib/categorize";
import { WorkflowCard } from "./WorkflowCard";
import type { ViewMode } from "./WorkflowsToolbar";
import s from "./page.module.css";

interface Props {
  category: WorkflowCategoryMeta;
  workflows: WorkflowSummary[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  selectMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  viewMode: ViewMode;
}

export function CategorySection({
  category, workflows, onOpen, onDelete, onDuplicate, onRename,
  selectMode, selectedIds, onToggleSelect, viewMode,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ marginBottom: 28 }}>
      <div className={s.catSectionHead}>
        <div
          className={s.catSectionIcon}
          style={{ background: category.colorTint, color: category.color }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
        </div>
        <span className={s.catSectionName}>{category.shortLabel}</span>
        <span
          className={s.catSectionCount}
          style={{ background: category.colorTint, color: category.color }}
        >
          {workflows.length}
        </span>
        <div className={s.catSectionSpacer} />
        <button
          className={s.catSectionCollapse}
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {!collapsed && (
        <div className={s.workflowGrid} data-view={viewMode}>
          {workflows.map(wf => (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              onOpen={onOpen}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onRename={onRename}
              onToggleSelect={onToggleSelect}
              isSelected={selectedIds.has(wf.id)}
              selectMode={selectMode}
              viewMode={viewMode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
