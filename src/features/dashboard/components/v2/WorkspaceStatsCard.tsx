import { useLocale } from "@/hooks/useLocale";
import s from "./dashboard.module.css";

interface WorkspaceStatsCardProps {
  stats: {
    workflowCount: number;
    executionCount: number;
    outputsCount: number;
    level: number;
    planLabel: string;
    used: number;
    effectiveLimit: number;
  } | null;
  loading: boolean;
}

const OUTPUTS_CAP = 6;

export function WorkspaceStatsCard({ stats, loading }: WorkspaceStatsCardProps) {
  const { t } = useLocale();
  const isLoading = loading || !stats;

  const execDelta = stats
    ? stats.planLabel === "Admin"
      ? `${stats.used} · admin · unlimited`
      : `${stats.used}/${stats.effectiveLimit} runs`
    : "";

  return (
    <div className={s.heroV3InlineStats}>
      <div className={s.heroV3InlineStat}>
        <div className={s.heroV3InlineStatLabel}>
          {t("dashboard.v2.statWorkflows")} · all-time
        </div>
        <div className={s.heroV3InlineStatVal}>
          {isLoading ? (
            <span className={s.skeleton} style={{ display: "inline-block", width: 56, height: 22 }} />
          ) : (
            stats.workflowCount
          )}
        </div>
        <div className={s.heroV3InlineStatDelta}>library</div>
      </div>

      <div className={s.heroV3InlineStat}>
        <div className={s.heroV3InlineStatLabel}>
          {t("dashboard.v2.statExecutions")} · success
        </div>
        <div className={s.heroV3InlineStatVal}>
          {isLoading ? (
            <span className={s.skeleton} style={{ display: "inline-block", width: 56, height: 22 }} />
          ) : (
            stats.executionCount
          )}
        </div>
        <div className={s.heroV3InlineStatDelta}>{isLoading ? "" : execDelta}</div>
      </div>

      <div className={s.heroV3InlineStat}>
        <div className={s.heroV3InlineStatLabel}>
          {t("dashboard.v2.statOutputs")} · recent
        </div>
        <div className={s.heroV3InlineStatVal}>
          {isLoading ? (
            <span className={s.skeleton} style={{ display: "inline-block", width: 56, height: 22 }} />
          ) : (
            <>
              {stats.outputsCount}
              <span className={s.heroV3InlineStatSuffix}>/{OUTPUTS_CAP}</span>
            </>
          )}
        </div>
        <div className={s.heroV3InlineStatDelta}>last cycle</div>
      </div>

      <div className={s.heroV3InlineStat}>
        <div className={s.heroV3InlineStatLabel}>
          {t("dashboard.v2.statXpLevel")} · max
        </div>
        <div className={s.heroV3InlineStatVal}>
          {isLoading ? (
            <span className={s.skeleton} style={{ display: "inline-block", width: 56, height: 22 }} />
          ) : (
            <>L{stats.level}</>
          )}
        </div>
        <div className={s.heroV3InlineStatDelta}>max tier</div>
      </div>
    </div>
  );
}
