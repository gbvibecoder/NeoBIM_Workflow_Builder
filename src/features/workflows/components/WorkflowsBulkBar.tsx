"use client";

import s from "./page.module.css";

interface Props {
  selectedCount: number;
  onDuplicate: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

export function WorkflowsBulkBar({
  selectedCount, onDuplicate, onDelete, onCancel,
}: Props) {
  if (selectedCount === 0) return null;

  return (
    <div className={s.bulkBar} role="toolbar" aria-label="Bulk actions">
      <span className={s.bulkBarCount}>{selectedCount} selected</span>
      <div className={s.bulkBarDivider} />
      <button className={s.bulkBarBtn} onClick={onDuplicate}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
        Duplicate
      </button>
      <button className={s.bulkBarBtn} data-danger="true" onClick={onDelete}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
        Delete {selectedCount}
      </button>
      <button className={s.bulkBarClose} onClick={onCancel} aria-label="Cancel selection">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </div>
  );
}
