"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DashboardHero } from "@/features/dashboard/components/v2/DashboardHero";
import { ProductTilesSection } from "@/features/dashboard/components/v2/ProductTilesSection";
import { FeaturedWorkflowsSection } from "@/features/dashboard/components/v2/FeaturedWorkflowsSection";
import { RecentWorkflowsSection } from "@/features/dashboard/components/v2/RecentWorkflowsSection";
import { ActivityFeed } from "@/features/dashboard/components/v2/ActivityFeed";
import { SuggestWorkflowBanner } from "@/features/dashboard/components/v2/SuggestWorkflowBanner";
import s from "@/features/dashboard/components/v2/dashboard.module.css";

// ─── Types (preserved from V1) ──────────────────────────────────────────────
interface DashboardData {
  userName: string | null;
  userRole: string;
  xp: number;
  level: number;
  progress: number;
  xpInLevel: number;
  xpForNext: number;
  workflowCount: number;
  executionCount: number;
  referralBonus: number;
  missions: unknown[];
  blueprints: unknown[];
  achievements: unknown[];
  flashEvent: unknown;
  recentWorkflows: Array<{
    id: string;
    name: string;
    category: string | null;
    updatedAt: string;
    nodeCount: number;
    executionCount: number;
  }>;
  recentOutputs?: Array<{
    id: string;
    type: string;
    dataUri: string | null;
    createdAt: string;
    workflowId: string;
    workflowName: string;
    workflowCategory: string | null;
  }>;
  recentActivity?: Array<{
    id: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    workflowId: string;
    workflowName: string;
    workflowCategory: string | null;
  }>;
}

const PLAN_LIMITS: Record<string, number> = { FREE: 3, MINI: 10, STARTER: 30, PRO: 100 };

const DEFAULT_DATA: DashboardData = {
  userName: null, userRole: "FREE",
  xp: 0, level: 1, progress: 0, xpInLevel: 0, xpForNext: 500,
  workflowCount: 0, executionCount: 0, referralBonus: 0,
  missions: [], blueprints: [], achievements: [],
  flashEvent: null, recentWorkflows: [],
};

// ═════════════════════════════════════════════════════════════════════════════
// MAIN PAGE — thin orchestrator
// ═════════════════════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);

  // ── Data fetch (preserved verbatim from V1) ──
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/user/dashboard-stats", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error("API error"); return r.json(); })
      .then((d: DashboardData) => { if (d && typeof d.workflowCount === "number") { setData(d); setLoading(false); } })
      .catch((err: Error) => { if (err.name !== "AbortError") { toast.error("Could not load dashboard data", { duration: 4000 }); setLoading(false); } });
    const timeout = setTimeout(() => controller.abort(), 5000);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);

  // ── Derived values (preserved from V1) ──
  const role = data.userRole ?? "FREE";
  const effectiveLimit = (PLAN_LIMITS[role] ?? 5) + (data.referralBonus ?? 0);
  const used = data.executionCount;
  const firstName = data.userName?.split(" ")[0] || "there";
  const planLabel = role === "PLATFORM_ADMIN" ? "Admin" : role === "TEAM_ADMIN" ? "Team" : role.charAt(0) + role.slice(1).toLowerCase();
  const outputsCount = (data.recentOutputs ?? []).length;
  const lastWorkflowId = data.recentWorkflows.length > 0 ? data.recentWorkflows[0].id : null;

  // Plan tier string for the strip
  const tierMap: Record<string, string> = { FREE: "01", MINI: "02", STARTER: "03", PRO: "04", TEAM_ADMIN: "05", PLATFORM_ADMIN: "06" };
  const planTier = `${planLabel} · Tier ${tierMap[role] ?? "01"}`;

  return (
    <div className={s.dashboardPage}>
      <div className={s.backdrop} aria-hidden="true" />
      <div className={s.container}>
        <DashboardHero
          firstName={firstName}
          planTier={planTier}
          stats={loading ? null : {
            workflowCount: data.workflowCount,
            executionCount: data.executionCount,
            outputsCount,
            level: data.level,
            planLabel,
            used,
            effectiveLimit,
          }}
          loading={loading}
          lastWorkflowId={lastWorkflowId}
        />
        <ProductTilesSection />
        <FeaturedWorkflowsSection />
        <RecentWorkflowsSection
          workflows={data.recentWorkflows}
          totalCount={data.workflowCount}
          loading={loading}
        />
        <ActivityFeed
          recentOutputs={(data.recentOutputs ?? []).map((o) => ({
            id: o.id, type: o.type, createdAt: o.createdAt, workflowName: o.workflowName,
          }))}
          recentActivity={(data.recentActivity ?? []).map((a) => ({
            id: a.id, status: a.status, createdAt: a.createdAt, workflowName: a.workflowName,
          }))}
          loading={loading}
        />
        <SuggestWorkflowBanner />
      </div>
    </div>
  );
}
