import { ChevronDown } from "lucide-react";
import type { WorkflowSummary } from "@/lib/api";
import { WorkflowCard } from "./WorkflowCard";
import type { ViewMode } from "./WorkflowsToolbar";
import s from "./page.module.css";

interface Props {
  workflows: WorkflowSummary[];
  totalCount: number;
  hasMore: boolean;
  onLoadMore: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  selectMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  viewMode: ViewMode;
  sectionEyebrow?: string;
  sectionTitle?: string;
}

export function AllWorkflowsGrid({
  workflows, totalCount, hasMore, onLoadMore,
  onOpen, onDelete, onDuplicate, onRename,
  selectMode, selectedIds, onToggleSelect,
  viewMode, sectionEyebrow, sectionTitle,
}: Props) {
  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <div className={s.sectionEyebrow}>
            <span className={s.sectionNum}>
              {sectionEyebrow === "results" ? "" : "03 \u2013"}
            </span>{" "}
            {sectionEyebrow === "results" ? "Search results" : "All workflows"}
          </div>
          <h2 className={s.sectionTitle}>
            {sectionTitle ? (
              <>{sectionTitle}</>
            ) : (
              <>Everything <em>in one place.</em></>
            )}
          </h2>
        </div>
        <span className={s.sectionMeta}>
          Showing {workflows.length} of {totalCount}
        </span>
      </div>

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

      {hasMore && (
        <div className={s.loadMoreWrap}>
          <span className={s.loadMoreMeta}>
            {workflows.length} of {totalCount} workflows
          </span>
          <button className={s.loadMoreBtn} onClick={onLoadMore}>
            <ChevronDown size={14} /> Load more
          </button>
        </div>
      )}
    </div>
  );
}
