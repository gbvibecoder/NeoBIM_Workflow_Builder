"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { WorkflowSummary } from "@/lib/api";
import { getLastRun } from "@/lib/api";
import { resolveCategory } from "@/features/workflows/lib/categorize";
import { formatRelativeShort, pluralRuns } from "@/features/workflows/lib/format";
import { WorkflowPreview } from "./WorkflowPreview";
import { WorkflowContextMenu } from "./WorkflowContextMenu";
import type { ViewMode } from "./WorkflowsToolbar";
import s from "./page.module.css";

interface Props {
  workflow: WorkflowSummary;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onToggleSelect: (id: string) => void;
  isSelected: boolean;
  selectMode: boolean;
  viewMode: ViewMode;
}

export function WorkflowCard({
  workflow, onOpen, onDelete, onDuplicate, onRename,
  onToggleSelect, isSelected, selectMode, viewMode,
}: Props) {
  const cat = resolveCategory(workflow);
  const lastRun = getLastRun(workflow);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(workflow.name);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraftName(workflow.name); }, [workflow.name]);
  useEffect(() => {
    if (isRenaming) { renameRef.current?.focus(); renameRef.current?.select(); }
  }, [isRenaming]);

  const submitRename = useCallback(() => {
    const name = draftName.trim();
    if (name && name !== workflow.name) onRename(workflow.id, name);
    else setDraftName(workflow.name);
    setIsRenaming(false);
  }, [draftName, workflow.id, workflow.name, onRename]);

  return (
    <>
      <div
        className={s.workflowCard}
        data-selected={isSelected ? "true" : undefined}
        data-view={viewMode}
        onClick={() => {
          if (isRenaming) return;
          if (selectMode) { onToggleSelect(workflow.id); return; }
          onOpen(workflow.id);
        }}
        onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); }}
        tabIndex={0}
        onKeyDown={e => { if (e.key === "F2" && !selectMode) setIsRenaming(true); }}
      >
        {/* Image / preview */}
        <div className={s.workflowCardImg}>
          <div className={s.workflowCardStripe} style={{ background: `linear-gradient(90deg, ${cat.gradientFrom}, ${cat.gradientTo})` }} />
          <WorkflowPreview workflowId={workflow.id} thumbnailUrl={workflow.thumbnail} category={cat} variant={viewMode === "list" ? "small" : "small"} />

          {/* Status pill */}
          {lastRun.status && !selectMode && (
            <div className={s.workflowCardStatus} data-status={lastRun.status.toLowerCase()}>
              <span className={s.statusDot} />
              {statusLabel(lastRun.status)}
            </div>
          )}

          {/* Hover actions */}
          {!selectMode && (
            <div className={s.workflowCardActions}>
              <button className={s.workflowCardAction} onClick={e => { e.stopPropagation(); onOpen(workflow.id); }} title="Open">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
              </button>
              <button className={s.workflowCardAction} onClick={e => { e.stopPropagation(); onDuplicate(workflow.id); }} title="Duplicate">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
              </button>
              <button className={`${s.workflowCardAction} ${s.workflowCardActionDanger}`} onClick={e => { e.stopPropagation(); onDelete(workflow.id); }} title="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
              </button>
            </div>
          )}

          {/* Select checkbox */}
          {selectMode && (
            <div className={s.workflowCardCheckbox} data-checked={isSelected ? "true" : undefined}>
              {isSelected && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="14" height="14"><path d="M5 12l4 4L19 6" /></svg>
              )}
            </div>
          )}
        </div>

        {/* Meta */}
        <div className={s.workflowCardMeta}>
          <div className={s.workflowCardCatRow}>
            <span className={s.workflowCardCat} style={{ color: cat.color }}>
              <span className={s.workflowCardCatDot} style={{ background: cat.color }} />
              {cat.label}
            </span>
            {workflow.tags.length > 0 && (
              <div className={s.workflowCardTags}>
                {workflow.tags.slice(0, 2).map(tag => (
                  <span key={tag} className={s.workflowCardTag}>{tag}</span>
                ))}
              </div>
            )}
            {workflow.isPublished && (
              <span className={s.workflowCardPublished}>Published</span>
            )}
          </div>

          {isRenaming ? (
            <input
              ref={renameRef}
              className={s.workflowCardTitleInput}
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              onBlur={submitRename}
              onKeyDown={e => { if (e.key === "Enter") submitRename(); if (e.key === "Escape") { setDraftName(workflow.name); setIsRenaming(false); } }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <h3
              className={s.workflowCardTitle}
              onDoubleClick={e => { e.stopPropagation(); if (!selectMode) setIsRenaming(true); }}
              title="Double-click to rename"
            >
              {workflow.name}
            </h3>
          )}

          {workflow.description && <p className={s.workflowCardDesc}>{workflow.description}</p>}

          <div className={s.workflowCardStats}>
            <span>{formatRelativeShort(workflow.updatedAt)}</span>
            <span className={s.workflowCardStatDot} />
            <span>{pluralRuns(workflow._count.executions)}</span>
          </div>
        </div>
      </div>

      {contextMenu && (
        <WorkflowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onOpen={() => { onOpen(workflow.id); setContextMenu(null); }}
          onRename={() => { setIsRenaming(true); setContextMenu(null); }}
          onDuplicate={() => { onDuplicate(workflow.id); setContextMenu(null); }}
          onDelete={() => { onDelete(workflow.id); setContextMenu(null); }}
        />
      )}
    </>
  );
}

function statusLabel(st: string): string {
  switch (st) {
    case "SUCCESS": return "Success";
    case "FAILED": return "Failed";
    case "PARTIAL": return "Partial";
    case "RUNNING": return "Running";
    default: return st;
  }
}
