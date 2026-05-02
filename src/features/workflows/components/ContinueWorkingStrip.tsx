import type { WorkflowSummary } from "@/lib/api";
import { getLastRun } from "@/lib/api";
import { resolveCategory } from "@/features/workflows/lib/categorize";
import { formatRelativeShort, pluralRuns } from "@/features/workflows/lib/format";
import { buildWeeklySparkline } from "@/features/workflows/lib/sparkline";
import { WorkflowPreview } from "./WorkflowPreview";
import { WorkflowSparkline } from "./WorkflowSparkline";
import s from "./page.module.css";

interface Props {
  workflows: WorkflowSummary[];
  onOpen: (id: string) => void;
}

export function ContinueWorkingStrip({ workflows, onOpen }: Props) {
  if (workflows.length === 0) return null;
  const [hero, ...rest] = workflows;

  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <div className={s.sectionEyebrow}>
            <span className={s.sectionNum}>01 &ndash;</span> Continue working
          </div>
          <h2 className={s.sectionTitle}>
            Pick up <em>where you left off.</em>
          </h2>
        </div>
        <span className={s.sectionMeta}>{workflows.length} active</span>
      </div>
      <div className={s.continueGrid}>
        <HeroCard workflow={hero} onOpen={onOpen} />
        {rest.slice(0, 2).map(wf => (
          <RegularCard key={wf.id} workflow={wf} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function HeroCard({ workflow, onOpen }: { workflow: WorkflowSummary; onOpen: (id: string) => void }) {
  const cat = resolveCategory(workflow);
  const lastRun = getLastRun(workflow);
  const sparkline = buildWeeklySparkline(workflow.executions, 12);
  const hasActivity = sparkline.some(b => b.count > 0);

  return (
    <div className={`${s.continueCard} ${s.continueCardHero}`} onClick={() => onOpen(workflow.id)}>
      <div className={s.continueCardImg}>
        <div className={s.continueCardBg}>
          <WorkflowPreview workflowId={workflow.id} thumbnailUrl={workflow.thumbnail} category={cat} variant="large" />
        </div>
        <div className={s.continueCardStripe} style={{ background: `linear-gradient(90deg, ${cat.gradientFrom}, ${cat.gradientTo})` }} />
        <div className={s.continueCardTag}>
          <span className={s.continueCardTagDot} style={{ background: cat.color }} />
          {cat.label}
        </div>
        {lastRun.status && (
          <div className={s.workflowCardStatus} data-status={lastRun.status.toLowerCase()}>
            <span className={s.statusDot} />
            {lastRun.status === "SUCCESS" ? "Success" : lastRun.status === "FAILED" ? "Failed" : lastRun.status}
          </div>
        )}
      </div>
      <div className={s.continueCardMeta}>
        <div className={s.continueCardCatRow}>
          <span className={s.workflowCardCat} style={{ color: cat.color }}>
            <span className={s.workflowCardCatDot} style={{ background: cat.color }} />
            {cat.label}
          </span>
          <span className={s.continueCardBadge}>Most Recent</span>
        </div>
        <h3 className={s.continueCardTitle}>{workflow.name}</h3>
        {workflow.description && <p className={s.continueCardDesc}>{workflow.description}</p>}
        <div className={s.continueCardStats}>
          <span>{formatRelativeShort(lastRun.completedAt ?? workflow.updatedAt)}</span>
          <span className={s.continueCardStatDot} />
          <span>{pluralRuns(workflow._count.executions)}</span>
        </div>
        {hasActivity && (
          <div className={s.continueCardSparkline}>
            <span className={s.continueCardSparklineLabel}>12 weeks</span>
            <WorkflowSparkline bars={sparkline} />
          </div>
        )}
        <button
          className={s.continueCardResume}
          onClick={e => { e.stopPropagation(); onOpen(workflow.id); }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><polygon points="5 3 19 12 5 21" /></svg>
          Resume work
        </button>
      </div>
    </div>
  );
}

function RegularCard({ workflow, onOpen }: { workflow: WorkflowSummary; onOpen: (id: string) => void }) {
  const cat = resolveCategory(workflow);
  const lastRun = getLastRun(workflow);

  return (
    <div className={s.continueCard} onClick={() => onOpen(workflow.id)}>
      <div className={s.continueCardImg}>
        <div className={s.continueCardBg}>
          <WorkflowPreview workflowId={workflow.id} thumbnailUrl={workflow.thumbnail} category={cat} variant="small" />
        </div>
        <div className={s.continueCardStripe} style={{ background: `linear-gradient(90deg, ${cat.gradientFrom}, ${cat.gradientTo})` }} />
        <div className={s.continueCardTag}>
          <span className={s.continueCardTagDot} style={{ background: cat.color }} />
          {cat.label}
        </div>
        {lastRun.status && (
          <div className={s.workflowCardStatus} data-status={lastRun.status.toLowerCase()}>
            <span className={s.statusDot} />
            {lastRun.status === "SUCCESS" ? "Success" : lastRun.status === "FAILED" ? "Failed" : lastRun.status}
          </div>
        )}
      </div>
      <div className={s.continueCardMeta}>
        <h3 className={s.continueCardTitle}>{workflow.name}</h3>
        <div className={s.continueCardStats}>
          <span>{formatRelativeShort(lastRun.completedAt ?? workflow.updatedAt)}</span>
          <span className={s.continueCardStatDot} />
          <span>{pluralRuns(workflow._count.executions)}</span>
        </div>
      </div>
    </div>
  );
}
