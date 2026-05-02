import { Plus, ArrowRight } from "lucide-react";
import s from "./page.module.css";

interface Props {
  totalCount: number;
  totalRuns: number;
  onNewWorkflow: () => void;
  onBrowseTemplates: () => void;
}

export function WorkflowsHero({
  totalCount,
  totalRuns,
  onNewWorkflow,
  onBrowseTemplates,
}: Props) {
  return (
    <div className={s.pageHead}>
      <div className={s.pageHeadInner}>
        <div>
          <div className={s.pageEyebrowRow}>
            <span className={s.pageEyebrow}>My Workflows</span>
            <span className={s.pageCountPill}>
              <span className={s.pageCountDot} />
              {totalCount} workflow{totalCount !== 1 ? "s" : ""}
              {" \u00B7 "}
              {totalRuns} run{totalRuns !== 1 ? "s" : ""}
            </span>
          </div>
          <h1 className={s.pageTitle}>
            Your portfolio, <em>stitched together.</em>
          </h1>
          <p className={s.pageLead}>
            Every workflow you&apos;ve built lives here. Search, filter, and pick up
            where you left off &mdash; or start fresh.
          </p>
        </div>
        <div className={s.pageActions}>
          <button className={s.btnPrimary} onClick={onNewWorkflow}>
            <Plus size={14} strokeWidth={2.5} /> New Workflow
          </button>
          <button className={s.btnGhost} onClick={onBrowseTemplates}>
            Templates <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
