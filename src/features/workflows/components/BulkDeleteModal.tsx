import { AlertTriangle, Trash2 } from "lucide-react";
import s from "./page.module.css";

interface Props {
  count: number;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function BulkDeleteModal({ count, isDeleting, onCancel, onConfirm }: Props) {
  return (
    <div className={s.modalOverlay} onClick={() => !isDeleting && onCancel()}>
      <div className={s.modalPanel} onClick={e => e.stopPropagation()}>
        <div className={s.modalAccent} style={{ background: "linear-gradient(90deg, #dc3545, #a71d2a, #dc3545)" }} />
        <div className={s.modalBody}>
          <div className={s.modalIcon} style={{ background: "rgba(220, 53, 69, 0.08)", border: "1px solid rgba(220, 53, 69, 0.2)" }}>
            <AlertTriangle size={26} color="#dc3545" />
          </div>
          <h2 className={s.modalTitle}>
            Delete {count} workflow{count !== 1 ? "s" : ""} permanently?
          </h2>
          <p className={s.modalDesc}>
            The selected workflows will be removed from your account and their
            generated files will be wiped from cloud storage.{" "}
            <strong style={{ color: "#dc3545" }}>This action cannot be undone.</strong>
          </p>
        </div>
        <div className={s.modalFooter}>
          <div className={s.modalWarningBox}>
            <div className={s.modalWarningLine}>{"\u2022"} Removed from your workflow list</div>
            <div className={s.modalWarningLine}>{"\u2022"} Generated files and uploaded media wiped from cloud storage</div>
            <div className={s.modalWarningLine}>{"\u2022"} Cannot be reopened or recovered</div>
          </div>
          <div className={s.modalBtnRow}>
            <button className={s.modalBtnCancel} onClick={onCancel} disabled={isDeleting}>
              Cancel
            </button>
            <button className={s.modalBtnDanger} onClick={onConfirm} disabled={isDeleting}>
              <Trash2 size={14} />
              {isDeleting ? "Deleting\u2026" : `Delete ${count}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
