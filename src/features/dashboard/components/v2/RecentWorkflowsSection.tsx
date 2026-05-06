import Link from "next/link";
import { useLocale } from "@/hooks/useLocale";
import { SectionHead } from "./SectionHead";
import s from "./dashboard.module.css";

interface RecentWorkflow {
  id: string;
  name: string;
  category: string | null;
  updatedAt: string;
  nodeCount: number;
  executionCount: number;
}

interface RecentWorkflowsSectionProps {
  workflows: RecentWorkflow[];
  totalCount: number;
  loading: boolean;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function isDarkThumb(wf: RecentWorkflow): boolean {
  const h = `${wf.category ?? ""} ${wf.name ?? ""}`.toLowerCase();
  const isFloorOrBoq = h.includes("floor plan") || h.includes("floor-plan") || h.includes("layout") || h.includes("boq") || h.includes("cost");
  const isBimOrRender = h.includes("ifc") || h.includes("bim") || h.includes("render") || h.includes("video") || h.includes("walkthrough");
  return !isFloorOrBoq && isBimOrRender;
}

export function RecentWorkflowsSection({ workflows, totalCount, loading }: RecentWorkflowsSectionProps) {
  const { t } = useLocale();

  const linkLabel = totalCount > 0
    ? t("dashboard.v2.section3Link").replace("{count}", String(totalCount))
    : t("dashboard.v2.statsViewAll");

  return (
    <section>
      <SectionHead
        num={t("dashboard.v2.section3Num")}
        title={
          <>
            {t("dashboard.v2.section3Title")} <em>{t("dashboard.v2.section3TitleEm")}</em> {t("dashboard.v2.section3TitleSuffix")}
          </>
        }
        sub={t("dashboard.v2.section3Sub")}
        link={{ label: linkLabel, href: "/dashboard/workflows" }}
      />

      <div className={s.recent}>
        {loading ? (
          [0, 1, 2].map((i) => (
            <div key={i} className={s.recentCard}>
              <div className={s.recentThumb}>
                <div className={s.skeleton} style={{ width: "100%", height: "100%" }} />
              </div>
              <div className={s.recentBody}>
                <div className={s.skeleton} style={{ width: "70%", height: 16, marginBottom: 8 }} />
                <div className={s.skeleton} style={{ width: "50%", height: 12 }} />
              </div>
            </div>
          ))
        ) : workflows.length === 0 ? (
          <div className={s.recentEmpty}>
            {t("dashboard.v2.recentEmpty").split("→")[0]}
            <Link href="/dashboard/templates" className={s.recentEmptyLink}>
              → {t("dashboard.v2.browseTemplates")}
            </Link>
          </div>
        ) : (
          workflows.slice(0, 3).map((wf) => {
            const dark = isDarkThumb(wf);
            return (
              <Link key={wf.id} href={`/dashboard/canvas?id=${wf.id}`} className={s.recentCard}>
                <div className={s.recentThumb} data-dark={dark}>
                  <RecentThumbIllustration workflow={wf} />
                  <div className={s.recentBadge} data-dark={dark}>
                    <span className={s.recentBadgeDot} />
                    {wf.nodeCount} nodes
                  </div>
                </div>
                <div className={s.recentBody}>
                  <div className={s.recentName}>{wf.name}</div>
                  <div className={s.recentMeta}>
                    <span className={s.recentRuns}>{wf.executionCount} run{wf.executionCount !== 1 ? "s" : ""}</span>
                    <span className={s.recentTime}>{formatRelativeTime(wf.updatedAt)}</span>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}

function RecentThumbIllustration({ workflow }: { workflow: RecentWorkflow }) {
  const h = `${workflow.category ?? ""} ${workflow.name ?? ""}`.toLowerCase();

  if (h.includes("floor plan") || h.includes("floor-plan") || h.includes("layout")) {
    return (
      <svg viewBox="0 0 280 140" fill="none" style={{ width: "100%", height: "100%" }}>
        <g stroke="var(--rs-ink, #0E1218)" strokeWidth="1.6" fill="none" opacity="0.7">
          <rect x="40" y="20" width="200" height="100" />
          <line x1="140" y1="20" x2="140" y2="70" />
          <line x1="80" y1="70" x2="240" y2="70" />
        </g>
        <g fontFamily="JetBrains Mono, monospace" fontSize="6" fill="var(--rs-text, #5A6478)" letterSpacing="1">
          <text x="84" y="48">LIVING</text>
          <text x="180" y="48">KITCHEN</text>
        </g>
      </svg>
    );
  }

  if (h.includes("ifc") || h.includes("bim") || h.includes("model")) {
    return (
      <svg viewBox="0 0 280 140" fill="none" style={{ width: "100%", height: "100%" }}>
        <g stroke="rgba(229,168,120,0.85)" strokeWidth="1.4" fill="none">
          <polygon points="80,110 140,80 200,110 140,130" />
          <polygon points="80,50 140,20 200,50 140,80" />
          <line x1="80" y1="110" x2="80" y2="50" />
          <line x1="200" y1="110" x2="200" y2="50" />
          <line x1="140" y1="130" x2="140" y2="80" />
        </g>
      </svg>
    );
  }

  if (h.includes("render") || h.includes("video") || h.includes("walkthrough")) {
    return (
      <svg viewBox="0 0 280 140" fill="none" style={{ width: "100%", height: "100%" }}>
        <defs>
          <linearGradient id="recentRenderSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(229,168,120,0.65)" />
            <stop offset="100%" stopColor="rgba(194,106,59,0.35)" />
          </linearGradient>
        </defs>
        <rect width="280" height="140" fill="url(#recentRenderSky)" />
        <path d="M0 95 L30 95 L30 75 L60 75 L60 90 L100 90 L100 60 L140 60 L140 85 L180 85 L180 70 L220 70 L220 92 L280 92 L280 140 L0 140 Z" fill="rgba(15,24,34,0.72)" />
      </svg>
    );
  }

  // Default geometric pattern
  return (
    <svg viewBox="0 0 280 140" fill="none" style={{ width: "100%", height: "100%" }}>
      <g stroke="var(--rs-ink-soft, #2A3142)" strokeWidth="1.6" fill="none" opacity="0.6">
        <rect x="30" y="30" width="60" height="40" rx="4" />
        <rect x="110" y="20" width="60" height="60" rx="4" />
        <rect x="190" y="40" width="50" height="30" rx="4" />
        <line x1="90" y1="50" x2="110" y2="50" strokeWidth="1.2" />
        <line x1="170" y1="50" x2="190" y2="55" strokeWidth="1.2" />
      </g>
    </svg>
  );
}
