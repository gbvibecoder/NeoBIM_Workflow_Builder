"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { DateRangeFilter } from "@/features/admin/components/survey/DateRangeFilter";
import { FunnelChart, type FunnelRow } from "@/features/admin/components/survey/FunnelChart";
import { SurveyPieCharts, type PieBucket } from "@/features/admin/components/survey/SurveyPieCharts";
import { SurveyStatsCards } from "@/features/admin/components/survey/SurveyStatsCards";
import { RecentResponsesTable } from "@/features/admin/components/survey/RecentResponsesTable";

type StatsShape = {
  totalSurveys: number;
  completed: number;
  completionRate: number;
  avgTimeSeconds: number;
  commonSkipScene: number | null;
  topDiscovery: string | null;
};

interface ApiResponse {
  funnel: FunnelRow[];
  pies: {
    discovery: PieBucket[];
    profession: PieBucket[];
    teamSize: PieBucket[];
    pricing: PieBucket[];
    utmSource: PieBucket[];
    country: PieBucket[];
    deviceType: PieBucket[];
  };
  stats: StatsShape;
  recent: Parameters<typeof RecentResponsesTable>[0]["rows"];
}

export default function SurveyAnalyticsPage() {
  const { t } = useLocale();
  const [rangeId, setRangeId] = useState<string>("30");
  const [range, setRange] = useState<{ from?: string; to?: string }>(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  });
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      const res = await fetch(`/api/admin/survey-analytics?${params.toString()}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as ApiResponse;
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <div style={{ padding: "28px 24px", display: "flex", flexDirection: "column", gap: 24, minHeight: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-jetbrains), monospace",
              marginBottom: 6,
            }}
          >
            {t("admin.survey.eyebrow")}
          </div>
          <h1
            style={{
              fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              margin: 0,
              color: "var(--text-primary)",
            }}
          >
            {t("admin.survey.title")}
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6 }}>
            {t("admin.survey.subtitle")}
          </p>
        </div>
        <DateRangeFilter
          value={rangeId}
          onChange={(id, r) => {
            setRangeId(id);
            setRange(r);
          }}
        />
      </div>

      {error && (
        <div
          style={{
            padding: "14px 18px",
            borderRadius: 10,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            color: "#F87171",
            fontSize: 13,
          }}
        >
          {t("admin.survey.loadError")}: {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ padding: 48, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
          {t("admin.survey.loading")}
        </div>
      )}

      {data && (
        <>
          <SurveyStatsCards stats={data.stats} />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {t("admin.survey.funnel")}
              </div>
              <FunnelChart rows={data.funnel} />
            </div>
            <RecentResponsesTable rows={data.recent} pageSize={10} />
          </div>

          <SurveyPieCharts
            discovery={data.pies.discovery}
            profession={data.pies.profession}
            teamSize={data.pies.teamSize}
            pricing={data.pies.pricing}
            utmSource={data.pies.utmSource}
            country={data.pies.country}
            deviceType={data.pies.deviceType}
          />
        </>
      )}
    </div>
  );
}
