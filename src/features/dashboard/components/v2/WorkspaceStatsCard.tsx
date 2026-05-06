import Link from "next/link";
import { ArrowRight, Crown } from "lucide-react";
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

export function WorkspaceStatsCard({ stats, loading }: WorkspaceStatsCardProps) {
  const { t } = useLocale();

  return (
    <div className={s.statsCard}>
      <div className={s.statsStrip}>
        <span className={s.statsStripNum}>FB-S00</span>
      </div>
      <div className={s.statsBody}>
        <div className={s.statsTitle}>
          <span className={s.statsTitleText}>
            {t("dashboard.v2.statsTitle")}{" "}
            <em className={s.statsTitleEm}>{t("dashboard.v2.statsTitleEm")}</em>
          </span>
          <Link href="/dashboard/workflows" className={s.statsTitleLink}>
            {t("dashboard.v2.statsViewAll")} <ArrowRight size={12} />
          </Link>
        </div>

        <div className={s.statsGrid}>
          {loading || !stats ? (
            <>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={s.statsTile}>
                  <div className={s.statsTileValue}>
                    <span className={s.skeleton} style={{ display: "inline-block", width: 32, height: 24 }} />
                  </div>
                  <div className={s.statsTileLabel}>
                    <span className={s.skeleton} style={{ display: "inline-block", width: 48, height: 10 }} />
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className={s.statsTile}>
                <div className={s.statsTileValue}>{stats.workflowCount}</div>
                <div className={s.statsTileLabel}>{t("dashboard.v2.statWorkflows")}</div>
              </div>
              <div className={s.statsTile}>
                <div className={s.statsTileValue}>{stats.executionCount}</div>
                <div className={s.statsTileLabel}>{t("dashboard.v2.statExecutions")}</div>
              </div>
              <div className={s.statsTile}>
                <div className={s.statsTileValue}>{stats.outputsCount}</div>
                <div className={s.statsTileLabel}>{t("dashboard.v2.statOutputs")}</div>
              </div>
              <div className={s.statsTile}>
                <div className={s.statsTileValue}>L{stats.level}</div>
                <div className={s.statsTileLabel}>{t("dashboard.v2.statXpLevel")}</div>
              </div>
            </>
          )}
        </div>

        {loading || !stats ? (
          <div className={s.statsPlan}>
            <span className={s.skeleton} style={{ display: "inline-block", width: 100, height: 24 }} />
          </div>
        ) : (
          <div className={s.statsPlan}>
            <div className={s.statsPlanInfo}>
              <span className={s.statsPlanIcon}>
                <Crown size={11} /> {stats.planLabel}
              </span>
              <span className={s.statsPlanName}>{stats.planLabel} plan</span>
            </div>
            <div className={s.statsPlanUsage}>
              {stats.used}/{stats.effectiveLimit} runs
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
