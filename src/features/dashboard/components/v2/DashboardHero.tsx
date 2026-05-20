import Link from "next/link";
import { ArrowRight, Plus, Sparkles } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { NodesCanvas } from "./NodesCanvas";
import { WorkspaceStatsCard } from "./WorkspaceStatsCard";
import { PipelineSteps } from "./PipelineSteps";
import s from "./dashboard.module.css";

interface DashboardHeroProps {
  firstName: string;
  planTier: string;
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
  lastWorkflowId: string | null;
}

export function DashboardHero({ firstName, stats, loading, lastWorkflowId }: DashboardHeroProps) {
  const { t } = useLocale();
  const hasLast = lastWorkflowId !== null;

  return (
    <section className={s.heroV3}>
      {/* QUIET GREETING — top of hero; FB-D00 strip removed (V6 declutter) */}
      <div className={s.heroV3GreetingLine}>
        <h1 className={s.heroV3Greeting}>
          {t("dashboard.v2.heroGreetingPrefix")}, <b>{firstName}</b>.
        </h1>
        <span className={s.heroV3GreetingSub}>
          — {t("dashboard.v2.heroEyebrow")}
        </span>
      </div>

      {/* TRANSFORMATION VISUAL — unchanged (C12 lock) */}
      <NodesCanvas />

      {/* ACTIONS ROW — CTAs left · inline stats right (flex; pitch removed) */}
      <div className={s.heroV3Actions}>
        <div className={s.heroV3CtaCluster}>
          {hasLast ? (
            <>
              <Link
                href={`/dashboard/canvas?id=${lastWorkflowId}`}
                className={`${s.heroV3Btn} ${s.heroV3BtnPrimary}`}
              >
                <ArrowRight size={14} />
                {t("dashboard.v2.continueLastWorkflow")}
              </Link>
              <Link href="/dashboard/canvas?new=1" className={s.heroV3Btn}>
                <Plus size={14} />
                {t("dashboard.v2.newBlankWorkflow")}
              </Link>
              <Link href="/dashboard/templates" className={s.heroV3Btn}>
                <Sparkles size={14} />
                {t("dashboard.v2.browseTemplates")}
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/dashboard/canvas?new=1"
                className={`${s.heroV3Btn} ${s.heroV3BtnPrimary}`}
              >
                <Plus size={14} />
                {t("dashboard.v2.newBlankWorkflow")}
              </Link>
              <Link href="/dashboard/templates" className={s.heroV3Btn}>
                <Sparkles size={14} />
                {t("dashboard.v2.browseTemplates")}
              </Link>
            </>
          )}
        </div>
        <WorkspaceStatsCard stats={stats} loading={loading} />
      </div>

      {/* PIPELINE — 5-step animated demo (CSS-only) */}
      <PipelineSteps />
    </section>
  );
}
