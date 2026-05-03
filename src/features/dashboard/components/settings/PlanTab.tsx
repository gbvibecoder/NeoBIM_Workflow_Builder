"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Crown, ArrowRight, Calendar } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { PLAN_EXEC_LIMITS } from "@/constants/limits";
import { getPlanLimits, formatPlanLimit } from "@/features/billing/lib/plan-helpers";
import s from "./settings.module.css";

export function PlanTab() {
  const { t } = useLocale();
  const router = useRouter();
  const { data: session } = useSession();

  const userRole = (session?.user as { role?: string } | undefined)?.role || "FREE";
  const stripeEnd = (session?.user as { stripeCurrentPeriodEnd?: string } | undefined)?.stripeCurrentPeriodEnd;

  const planLabel =
    userRole === "FREE" ? "Free" :
    userRole === "MINI" ? "Mini" :
    userRole === "STARTER" ? "Starter" :
    userRole === "PRO" ? "Pro" :
    userRole === "TEAM_ADMIN" ? "Team" :
    userRole === "PLATFORM_ADMIN" ? "Admin" : userRole;

  const execLimit = PLAN_EXEC_LIMITS[userRole] ?? 3;
  const limits = getPlanLimits(userRole);
  const isUnlimited = execLimit === -1;
  const isFree = userRole === "FREE";

  const renewalDate = stripeEnd
    ? new Date(stripeEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  return (
    <div>
      <div className={s.planCard}>
        <div className={s.planCardStrip}>
          <span className={s.planCardStripNum}>FB-S03 &middot; {t("settings.planCurrentSubscription")}</span>
        </div>
        <div className={s.planCardBody}>
          <div className={s.planCardInfo}>
            {!isFree && (
              <div className={s.planCardTag}>
                <Crown size={10} />
                {t("settings.planActive")}
              </div>
            )}
            <h2 className={s.planCardName}>
              <em>{planLabel}</em> {t("settings.planNameSuffix")}
            </h2>
            <p className={s.planCardDesc}>
              {isFree
                ? t("settings.freeRunsPerMonth")
                : isUnlimited
                  ? t("settings.unlimitedRuns")
                  : `${execLimit} ${t("settings.planMetaExecutions")}`}
            </p>
            <div className={s.planCardMeta}>
              <span className={s.planCardMetaPill}>
                <strong>{isUnlimited ? "\u221E" : execLimit}</strong> {t("settings.planMetaExecutions")}
              </span>
              {(limits.videoPerMonth as number) !== 0 && (
                <span className={s.planCardMetaPill}>
                  <strong>{formatPlanLimit(limits.videoPerMonth)}</strong> {t("settings.planMetaVideos")}
                </span>
              )}
              {(limits.modelsPerMonth as number) !== 0 && (
                <span className={s.planCardMetaPill}>
                  <strong>{formatPlanLimit(limits.modelsPerMonth)}</strong> {t("settings.planMeta3d")}
                </span>
              )}
              {(limits.rendersPerMonth as number) !== 0 && (
                <span className={s.planCardMetaPill}>
                  <strong>{formatPlanLimit(limits.rendersPerMonth)}</strong> {t("settings.planMetaRenders")}
                </span>
              )}
            </div>
          </div>
          <div className={s.planCardAction}>
            <button
              className={s.btnPrimary}
              onClick={() => router.push("/dashboard/billing")}
            >
              {isFree ? t("settings.planUpgradeOrChange") : t("settings.planManageBilling")}
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Renewal info */}
      {!isFree && (
        <div className={s.planRenewal}>
          <div className={s.planRenewalIcon}>
            <Calendar size={16} />
          </div>
          <div className={s.planRenewalInfo}>
            <div className={s.planRenewalLabel}>{t("settings.planRenews")}</div>
            <div className={s.planRenewalValue}>
              {renewalDate ?? "Active subscription"}
            </div>
          </div>
          <a href="/dashboard/billing" className={s.planRenewalLink}>
            {t("settings.planUpgradeOrChange")}
          </a>
        </div>
      )}
    </div>
  );
}
